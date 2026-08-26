# Architektur

```
                    Docker-Netz
                 ┌──────────────────────────┐
Browser ──HTTP──>│ Node-Server ──┐          │
                 │               ├──> Postgres
Agent ──stdio──> │ MCP-Server ───┘          │
                 └──────────────────────────┘
```

Alles läuft in Containern; nach außen ist nur Port 8080 offen. Der MCP-Client
startet `mcp/run.sh`, das per `docker exec` in den laufenden App-Container geht
(oder notfalls einen eigenen Container startet) und stdio durchreicht.

Der MCP-Server umgeht den Node-Server bewusst und spricht direkt mit Postgres:
ein Agent soll auch arbeiten können, wenn niemand die App offen hat.

## Dateien

| Datei | Zuständigkeit |
| --- | --- |
| `db/migrations/*.sql` | Schema und Auswertungs-Views. Beim Start angewendet, je Migration eine Transaktion. |
| `server/db.js` | Verbindung, Migrationen, Spiegeln der Lerninhalte in die Datenbank. |
| `server/store.js` | Alle SQL-Zugriffe der Anwendung an einem Ort. |
| `server/briefing.js` | Formuliert die Auswertung als Text. Rechnet nichts — das tun die Views. |
| `server/server.js` | HTTP-API, Auslieferung der App, SSE für Live-Aktualisierung. |
| `mcp/server.js` | JSON-RPC über stdio, ohne SDK. Werkzeuge für den Agenten. |
| `mcp/run.sh` | Startet ihn im Container und reicht stdio durch. Ausgaben nur nach stderr. |
| `server/mcp-http.js` | Derselbe Server über HTTP unter `/mcp`, optional mit Bearer-Token. |
| `mcpb/` | Quellen der `.mcpb`-Erweiterung für Claude Desktop / Cowork. |
| `src/store.js` | Browserseitiger Zugang zur API. Kein lokaler Speicher mehr. |
| `src/text.js` | Normalisierung und Antwortbewertung. Läuft in Browser **und** Node. |
| `src/packs.js` | Schema und Prüfung der Übungssätze. Ebenfalls in beiden Welten. |
| `src/drill.js` | Generischer Übungsablauf ohne DOM. |
| `src/app.js` | UI. Die einzige Datei, die das DOM kennt. |
| `src/deck.js` `conjugate.js` `grammar.js` | Lerninhalte als Quelltext. |

## Warum Ereignisse

`events` ist append-only: eine Zeile je Antwort, mit Zeitpunkt, Art,
richtig/falsch und der tatsächlichen Eingabe. Alles Weitere ist daraus
abgeleitet.

Das hat zwei Gründe. Erstens stand die Historie früher als `history`-Array in
jeder Karte, wuchs unbegrenzt und machte rund 96 % des gespeicherten Zustands
aus. Zweitens ist die getippte Antwort die einzige Möglichkeit, Verwechslungen
zu erkennen — `v_vocab_mistakes` verbindet die falsche Eingabe mit der Vokabel,
die tatsächlich gemeint war.

## Eine Definition von „Schwäche“

Alles Abgeleitete steckt in Views (`v_vocab_mistakes`, `v_conjugation_*`,
`v_grammar_accuracy`, `v_exercise_results`, `v_summary`). App, HTTP-API und
MCP lesen dieselben Views. Es gibt keinen zweiten Ort, an dem „hartnäckig“ oder
„schwach“ definiert wäre.

## Live-Aktualisierung

Ein Trigger auf `exercises` sendet `pg_notify`. Der Node-Server lauscht per
`LISTEN` und reicht das als Server-Sent-Event weiter. Legt ein Agent eine Übung
an, markiert sich der Tab „Übungen“ von selbst — ohne Neuladen.

## Erweitern

**Neuer Aufgabentyp:** in `src/packs.js` einen Eintrag in `ITEM_TYPES`
(`normalize`, `validate`, `check`) und in `src/app.js` einen Renderer in
`PACK_RENDERERS`. Die Werkzeugbeschreibung im MCP-Server nennt die Typen
automatisch.

**Neue Übungsart:** `src/drill.js` liefert Warteschlange, Bewertung, Fortschritt
und Priorisierung. Der Übungssatz-Ablauf in `app.js` ist das Vorbild.

**Schemaänderung:** neue nummerierte Datei in `db/migrations/`. Bestehende
Migrationen nie ändern.

**Hinweis:** Vokabel-, Konjugations- und Grammatikübung laufen noch auf drei
eigenen, weitgehend gleichen Schleifen statt auf `DRILL`. Mechanisch umstellbar,
bisher nicht gemacht.
