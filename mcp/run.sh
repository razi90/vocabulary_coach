#!/bin/sh
# Startet den MCP-Server im Container und reicht stdio durch.
#
# Wichtig: Auf stdout gehört ausschließlich das JSON-RPC-Protokoll. Alle
# Meldungen deshalb nach stderr.
set -e
cd "$(dirname "$0")/.."

CONTAINER=vokabeltrainer

# Läuft die App schon, ist exec der schnellste Weg – kein neuer Container.
if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" = "true" ]; then
  exec docker exec -i "$CONTAINER" node /app/mcp/server.js
fi

# Sonst einen eigenen Container starten; compose löst Netz und Image auf.
echo "App-Container läuft nicht – starte eigenen MCP-Container." >&2
exec docker compose run --rm --no-deps -T mcp
