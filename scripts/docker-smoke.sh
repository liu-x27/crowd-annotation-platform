#!/usr/bin/env bash
# Smoke-test a container image: it runs as a non-root user, declares /data as a volume and
# a health check, turns healthy, serves the web app and the API, and keeps its data in the
# volume across a restart. With --demo, an image built with DEMO_MODE=true: a demo instance
# starts from the demo database it carries, trains a model, and does it within 512 MB.
#
#   scripts/docker-smoke.sh <image>
#   scripts/docker-smoke.sh --demo <image>
set -euo pipefail

demo=false
if [ "${1:-}" = --demo ]; then
  demo=true
  shift
fi
image=$1
name=crowd-smoke-$$
volume=$name-data
port=${SMOKE_PORT:-4010}
smoke="$(dirname "$0")/smoke.mjs"

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT

healthy() {
  local status=none
  for _ in $(seq 1 45); do
    if [ "$(docker inspect --format '{{.State.Running}}' "$name")" != true ]; then
      echo "not ok - stopped: $(docker inspect --format 'exit={{.State.ExitCode}} oom-killed={{.State.OOMKilled}}' "$name")"
      docker logs "$name"
      return 1
    fi
    status=$(docker inspect --format '{{.State.Health.Status}}' "$name")
    if [ "$status" = healthy ]; then
      echo "ok - healthy"
      return 0
    fi
    sleep 2
  done
  echo "not ok - still $status after 90 s"
  docker logs "$name"
  return 1
}

# In GitHub Actions, also as a notice, readable from the run's annotations.
report() {
  echo "$1: $2"
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::notice title=$1::$2"; fi
}

config() { docker image inspect --format "{{json .Config.$1}}" "$image"; }
[ "$(config User)" = '"node"' ] || { echo "not ok - runs as $(config User)"; exit 1; }
config Volumes | grep -q '"/data"' || { echo "not ok - no /data volume"; exit 1; }
[ "$(config Healthcheck)" != null ] || { echo "not ok - no health check"; exit 1; }
echo "ok - runs as node, /data is a volume, has a health check"
report "$($demo && echo Demo image || echo Image) size" "$(docker image inspect --format '{{.Size}}' "$image" | awk '{printf "%.0f MB", $1 / 1e6}')"

# The highest memory use the container's cgroup has seen since it started.
peak() { docker exec "$name" cat /sys/fs/cgroup/memory.peak | awk '{printf "%.0f MiB", $1 / 1048576}'; }

if $demo; then
  # Once without a limit, to see what it needs; then within 512 MB and no swap, as on
  # Render's free plan, where going over restarts the instance.
  for limit in none 512m; do
    flags=()
    [ "$limit" = none ] || flags=(--memory "$limit" --memory-swap "$limit")
    docker run -d --name "$name" -p "$port:4000" -e DEMO_MODE=true ${flags[@]+"${flags[@]}"}       "$image" >/dev/null
    healthy
    node "$smoke" "http://127.0.0.1:$port" --demo
    logs=$(docker logs "$name" 2>&1)
    echo "$logs" | grep '^Demo:'
    state=$(docker inspect --format 'running={{.State.Running}} oom-killed={{.State.OOMKilled}} restarts={{.RestartCount}}' "$name")
    [ "$state" = "running=true oom-killed=false restarts=0" ] || { echo "not ok - $state"; exit 1; }
    report "Demo memory (limit $limit)" "now $(docker stats --no-stream --format '{{.MemUsage}}' "$name"), peak $(peak)"
    docker rm -f "$name" >/dev/null
  done
  exit 0
fi

docker run -d --name "$name" -p "$port:4000" -v "$volume:/data" "$image" >/dev/null
healthy
uid=$(docker exec "$name" id -u)
[ "$uid" != 0 ] || { echo "not ok - the server runs as root"; exit 1; }
echo "ok - the server runs as uid $uid"
node "$smoke" "http://127.0.0.1:$port"
docker restart "$name" >/dev/null
healthy
node "$smoke" "http://127.0.0.1:$port" --again
report "Container memory" "now $(docker stats --no-stream --format '{{.MemUsage}}' "$name"), peak $(peak)"
