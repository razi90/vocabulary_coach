# Vokabeltrainer — Anleitung für Agenten

Spanisch-Lern-App. Der Lernstand liegt in Postgres; du erreichst ihn über den
MCP-Server `vokabeltrainer` (stdio, läuft im Container, siehe `mcp/run.sh`).

## Der Ablauf

1. **`get_briefing`** — Lernstand und ein konkreter Auftrag. Immer hier anfangen.
2. Bei Bedarf nachfassen: `get_weaknesses` (strukturiert), `query_events`
   (Rohdaten inklusive der tatsächlichen Tippfehler), `search_vocabulary`
   (Wortschatz mit Lernstand je Wort).
3. **`create_exercise`** — passende Übungen anlegen. Sie erscheinen sofort im
   Tab „Übungen“ der App; offene Tabs aktualisieren sich von selbst.
4. `list_exercises` zeigt, was schon existiert und wie es lief. Was gesessen hat,
   mit `set_exercise_status` auf `archived` setzen, statt es liegen zu lassen.

## Was gute Übungen ausmacht

- **An echten Fehlern ansetzen.** Das Briefing nennt Verwechslungen wie
  „la puerta → el retraso“. Genau dafür Minimalpaare bauen.
- **Wortschatz nutzen, den der Lernende kennt.** `search_vocabulary` mit `topic`
  oder `level` filtern, statt neue Wörter einzuschleppen.
- **`explanation` ist der Lernwert.** Dort steht das Warum, nicht die Lösung.
  „Grund/Ursache → por“ ist gut; „Die Antwort ist por“ ist wertlos.
- **6 bis 12 Aufgaben je Satz.** Mehr wird in einer Sitzung nicht geübt.
- **Ein Thema je Satz.** „Por vs. para“ ja, „Gemischte Grammatik“ nein.

## Aufgabentypen

| Typ | Pflichtfelder | Hinweis |
| --- | --- | --- |
| `choice` | `options` (2–6), `answer` | `answer` muss exakt eine der `options` sein. Nur exakte Treffer zählen. |
| `cloze` | `prompt` mit `___`, `answer` | Akzente egal, ein Tippfehler gilt als „fast richtig“. |
| `translate` | `prompt`, `answer` | Zusätzlich `alternatives` angeben, wenn mehrere Formulierungen stimmen. |

Bei `cloze` und `translate` wird eine **Wortverwechslung** nicht verziehen —
„gracias para tu ayuda“ gilt als falsch, ein Vertipper wie „gracias pro tu
ayuda“ dagegen als fast richtig. Genau das soll die Übung ja prüfen.

## Wichtig

- Nichts direkt in `events` schreiben — das Protokoll gehört der App.
- `create_exercise` prüft streng und nennt den Grund einer Ablehnung. Fehler
  lesen und die Aufgabe korrigieren, nicht das Schema umgehen.
- Läuft der Stack nicht: `docker compose up -d` im Projektverzeichnis.

Aufbau und Datenmodell: [ARCHITEKTUR.md](ARCHITEKTUR.md).
