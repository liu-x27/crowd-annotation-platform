#!/bin/sh
# A demo instance (DEMO_MODE=true) whose data directory is still empty starts from the
# demo database built into the image, if it has one. With LOW_MEMORY=true, Node runs
# WebAssembly on its baseline compiler only: the embedded Postgres then needs about half
# the memory, and its queries take longer. Then the command, as PID 1.
set -e
flags=
case "$LOW_MEMORY" in
  true | 1 | yes) flags=--liftoff-only ;;
esac
case "$DEMO_MODE" in
  true | 1 | yes) node $flags /app/apps/server/dist/demo-restore.js ;;
esac
if [ "$1" = node ] && [ -n "$flags" ]; then
  shift
  set -- node "$flags" "$@"
fi
exec "$@"
