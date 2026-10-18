#!/bin/sh
# A demo instance (DEMO_MODE=true) whose data directory is still empty starts from the
# demo database built into the image, if it has one. Then the command, as PID 1.
set -e
case "$DEMO_MODE" in
  true | 1 | yes) node /app/apps/server/dist/demo-restore.js ;;
esac
exec "$@"
