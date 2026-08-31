#!/bin/sh
# Starts the MCP server in the container and pipes stdio through.
#
# Only the JSON-RPC protocol belongs on stdout. Every other output - Docker's
# included - has to go to stderr, otherwise the client takes it for protocol
# and gives up.
set -e

# Has to come first: processes started from a GUI do not inherit the shell's
# PATH. It lacks /usr/local/bin, where Docker Desktop lives - and in the worst
# case even /usr/bin, which is why no dirname is used below.
PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.docker/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
export PATH

# ${0%/*} instead of dirname: no external program needed.
case "$0" in
  */*) cd "${0%/*}/.." ;;
  *)   cd .. 2>/dev/null || true ;;
esac

APP=vokabeltrainer
DB=voco-db

DOCKER=$(command -v docker 2>/dev/null || true)
if [ -z "$DOCKER" ]; then
  for candidate in \
    /usr/local/bin/docker \
    /opt/homebrew/bin/docker \
    "$HOME/.docker/bin/docker" \
    /Applications/Docker.app/Contents/Resources/bin/docker
  do
    [ -x "$candidate" ] && { DOCKER="$candidate"; break; }
  done
fi
if [ -z "$DOCKER" ]; then
  echo "Docker nicht gefunden. Ist Docker Desktop installiert? (PATH=$PATH)" >&2
  exit 1
fi

if ! "$DOCKER" info >/dev/null 2>&1; then
  echo "Docker antwortet nicht – läuft Docker Desktop?" >&2
  exit 1
fi

running() { [ "$("$DOCKER" inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = "true" ]; }

# Fastest route: into the running app container, no new container.
if running "$APP"; then
  exec "$DOCKER" exec -i "$APP" node /app/mcp/server.js
fi

echo "App-Container läuft nicht – starte eigenen MCP-Container." >&2
running "$DB" || "$DOCKER" compose up -d db >&2

IMAGE=$("$DOCKER" compose config --images app 2>/dev/null | head -1)
[ -n "$IMAGE" ] || IMAGE=vocabulary_coach-app
"$DOCKER" image inspect "$IMAGE" >/dev/null 2>&1 || "$DOCKER" compose build app >&2

NET=$("$DOCKER" inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$DB")

exec "$DOCKER" run -i --rm --network "$NET" \
  -e PGHOST=db -e PGUSER=voco \
  -e PGPASSWORD="${POSTGRES_PASSWORD:-voco}" -e PGDATABASE=voco \
  "$IMAGE" node /app/mcp/server.js
