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

Der MCP-Server läuft auf dem Host und spricht direkt mit der Datenbank; die App
muss dafür nicht offen sein. Einmalig `npm install` ausführen, dann registrieren:

```json
{
  "mcpServers": {
    "vokabeltrainer": {
      "command": "node",
      "args": ["/Users/andreasrazmyslov/workspace/vocabulary_coach/mcp/server.js"],
      "env": {
        "PGHOST": "127.0.0.1",
        "PGPORT": "5432",
        "PGUSER": "voco",
        "PGPASSWORD": "voco",
        "PGDATABASE": "voco"
      }
    }
  }
}
```

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

Für den Zugriff vom Handy im selben WLAN in [docker-compose.yml](docker-compose.yml)
beim Dienst `app` `"127.0.0.1:8080:8080"` zu `"8080:8080"` ändern. Dann kann jeder
im Netz den Lernstand lesen und ändern. Den Postgres-Port dabei **nicht** öffnen.

Passwort setzen: `POSTGRES_PASSWORD=… docker compose up -d` oder eine `.env`.

## Sichern

```bash
docker compose exec -T db pg_dump -U voco voco > sicherung.sql
docker compose exec -T db psql -U voco -d voco < sicherung.sql   # zurückspielen
```

## Aufbau

Siehe [ARCHITEKTUR.md](ARCHITEKTUR.md).
