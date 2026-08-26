# Español — Vokabeltrainer

Spanisch lernen mit Karteikarten, Konjugations- und Grammatikübungen. Der
Lernstand liegt in Postgres. Ein Agent liest ihn über einen MCP-Server aus,
erkennt Schwächen und legt passende Übungen an, die sofort in der App auftauchen.

## Starten

```bash
docker compose up -d
```

`http://localhost:8080` öffnen. Beim ersten Start legt der Server das Schema an
und spiegelt die Lerninhalte (608 Vokabeln, 44 Verben, 58 Grammatikaufgaben) in
die Datenbank.

Nützliche Befehle:

```bash
docker compose up -d --build    # nach Codeänderungen
docker compose logs -f app      # mitlesen
docker compose down             # anhalten (Daten bleiben im Volume)
docker compose down -v          # anhalten und Lernstand löschen
```

`docker compose start` funktioniert nur, wenn die Container schon existieren —
nach einem `down` immer `up -d` nehmen.

## MCP-Server für den Agenten

### Variante A: Cowork / Claude Desktop (.mcpb-Erweiterung)

Cowork erreicht lokale MCP-Server über die Desktop-App. Dafür liegt ein fertiges
Bündel bereit: **`vokabeltrainer.mcpb`** im Projektverzeichnis.

Installieren: Claude öffnen → Einstellungen → Extensions → Advanced settings →
*Install Extension…* → `vokabeltrainer.mcpb` auswählen.

Das Bündel enthält keinen eigenen Server, sondern reicht stdio in den laufenden
Container durch (2 KB, kein `node_modules`). Es sucht Docker selbst an den
üblichen Orten — aus einer GUI gestartete Prozesse erben `/usr/local/bin` nicht —
und startet den Container, falls er gestoppt ist. Fehlt Docker ganz, kommt eine
verständliche Meldung statt eines stillen Fehlschlags.

Voraussetzung: einmal `docker compose up -d`, damit der Container existiert.

Nach Änderungen am Server neu packen:

```bash
npx @anthropic-ai/mcpb pack mcpb vokabeltrainer.mcpb
```

Das Bündel ist unsigniert; für eine lokal installierte Erweiterung ist das
normal. Signieren ginge mit `npx @anthropic-ai/mcpb sign --self-signed`.

### Variante B: Claude Code (stdio)

Der MCP-Server läuft **im Container**, im selben Docker-Netz wie die Datenbank.
Auf dem Host braucht es weder Node noch `npm install`, und der Postgres-Port
bleibt geschlossen.

```json
{
  "mcpServers": {
    "vokabeltrainer": {
      "command": "/Users/andreasrazmyslov/workspace/vocabulary_coach/mcp/run.sh"
    }
  }
}
```

[mcp/run.sh](mcp/run.sh) wählt den Weg selbst:

- läuft der App-Container, geht es per `docker exec` hinein — kein neuer Container;
- sonst startet es einen eigenen, und fährt bei Bedarf die Datenbank hoch.

Beides funktioniert unabhängig vom Arbeitsverzeichnis des Clients. Die App muss
dafür nicht offen sein.

### Variante C: über HTTP (für Clients, die nur eine URL akzeptieren)

Derselbe Server, dieselben Werkzeuge — nur ein anderer Transport. Er hängt am
laufenden App-Container, es ist also nichts zusätzlich zu starten:

```
http://localhost:8080/mcp
```

In Claude Code:

```bash
claude mcp add --transport http vokabeltrainer http://localhost:8080/mcp
```

In einer Konfigurationsdatei:

```json
{
  "mcpServers": {
    "vokabeltrainer": {
      "type": "http",
      "url": "http://localhost:8080/mcp"
    }
  }
}
```

Für einen Client, der HTTPS verlangt und nicht auf diesem Rechner läuft, gibt es
einen optionalen Tunnel:

```bash
echo "MCP_TOKEN=$(openssl rand -hex 24)" >> .env
echo "MCP_PORT=8081" >> .env
docker compose --profile tunnel up -d       # cloudflared, öffentliche HTTPS-URL
docker compose logs tunnel | grep trycloudflare
```

`MCP_PORT` startet einen zweiten Listener, der **ausschließlich** `/mcp` bedient —
die App und `/api` bleiben lokal. Nur dieser Port wird getunnelt. Ohne gesetztes
`MCP_TOKEN` verweigert der Server den Start, weil ein öffentlicher Endpunkt ohne
Token einem offenen Schreibzugriff auf die Datenbank gleichkäme.

**Mit Token** (nötig, sobald der Port nicht mehr nur auf localhost liegt):

```bash
echo "MCP_TOKEN=$(openssl rand -hex 24)" > .env
docker compose up -d app
```

Dann im Client `--header "Authorization: Bearer <token>"` mitgeben. Ohne
gesetztes `MCP_TOKEN` ist der Endpunkt offen — das ist nur vertretbar, solange
er ausschließlich auf `127.0.0.1` hört.

### Werkzeuge

| Werkzeug | Zweck |
| --- | --- |
| `get_briefing` | Lernstand als Markdown samt konkretem Auftrag. Der Einstieg. |
| `get_weaknesses` | Dasselbe strukturiert: Kennzahlen, Vokabelfehler mit Verwechslungen, Konjugation nach Form/Zeit/Person, Grammatik nach Kategorie. |
| `query_events` | Rohes Antwortprotokoll, inklusive der tatsächlichen Eingaben. |
| `search_vocabulary` | Wortschatz nach Thema, Niveau, Wortart durchsuchen — mit Lernstand je Wort. |
| `list_exercises` | Vorhandene Übungssätze und ihre Ergebnisse. |
| `create_exercise` | Übungssatz anlegen. Erscheint sofort in der App. |
| `set_exercise_status` | `ready` (sichtbar), `draft` (verborgen), `archived`. |
| `delete_exercise` | Entfernen; protokollierte Antworten bleiben. |

Aufgabentypen: `choice` (Auswahl), `cloze` (Lückentext mit `___`), `translate`.
Bei `cloze` und `translate` werden Akzente ignoriert und ein Tippfehler als
„fast richtig“ gewertet — eine Wortverwechslung dagegen nicht, sonst würde die
Übung genau den Fehler durchgehen lassen, den sie prüft. In `explanation` gehört
das Warum, nicht die Lösung.

Ungültige Aufgaben werden abgelehnt und der Grund zurückgemeldet; die Prüfung ist
dieselbe wie in der App ([src/packs.js](src/packs.js)).

## Direkt in der Datenbank nachsehen

```bash
docker compose exec db psql -U voco -d voco

\dv                              -- alle Auswertungs-Views
SELECT * FROM v_summary;
SELECT * FROM v_vocab_mistakes ORDER BY wrong DESC LIMIT 10;
SELECT * FROM v_grammar_accuracy ORDER BY accuracy;
```

## Sicherheit

Der Dienst hat **keine Anmeldung**. Deshalb sind sowohl App (8080) als auch
Postgres (5432) nur auf `127.0.0.1` veröffentlicht.

Postgres veröffentlicht überhaupt keinen Port mehr — es ist nur im Docker-Netz
erreichbar. Für `psql`: `docker compose exec db psql -U voco -d voco`.

Für den Zugriff vom Handy im selben WLAN in [docker-compose.yml](docker-compose.yml)
beim Dienst `app` `"127.0.0.1:8080:8080"` zu `"8080:8080"` ändern. Dann kann jeder
im Netz den Lernstand lesen und ändern.

Passwort setzen: `POSTGRES_PASSWORD=… docker compose up -d` oder eine `.env`.

## Sichern

```bash
docker compose exec -T db pg_dump -U voco voco > sicherung.sql
docker compose exec -T db psql -U voco -d voco < sicherung.sql   # zurückspielen
```

## Aufbau

Siehe [ARCHITEKTUR.md](ARCHITEKTUR.md).
