#!/bin/sh
# Startet den MCP-Server im Container und reicht stdio durch.
#
# Auf stdout gehört ausschließlich das JSON-RPC-Protokoll. Jede andere Ausgabe
# – auch die von Docker – muss nach stderr, sonst hält der Client sie für
# Protokoll und bricht ab.
set -e

# Muss ganz oben stehen: aus einer GUI gestartete Prozesse erben nicht die PATH
# der Shell. Dort fehlt /usr/local/bin, wo Docker Desktop liegt – und im
# Extremfall sogar /usr/bin, weshalb unten kein dirname benutzt wird.
PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.docker/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
export PATH

# ${0%/*} statt dirname: kein externes Programm nötig.
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

# Schnellster Weg: in den laufenden App-Container hinein, kein neuer Container.
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
