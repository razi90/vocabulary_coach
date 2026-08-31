# Vocabulary Coach — notes for agents

Spanish learning app for a German-speaking learner. The learning state lives in
Postgres; you reach it through the MCP server `vokabeltrainer` (stdio, runs in
the container, see `mcp/run.sh`).

The app's interface and all explanations are German, the exercises themselves
Spanish. Code, comments and docs are English.

## The flow

1. **`get_briefing`** — learning state plus a concrete assignment. Always start
   here.
2. Follow up if needed: `get_weaknesses` (structured), `query_events` (raw data
   including the actual typos), `search_vocabulary` (vocabulary with per-word
   learning state).
3. **`create_exercise`** — create fitting exercises. They show up in the app's
   "Übungen" tab immediately; open tabs refresh themselves.
4. `list_exercises` shows what already exists and how it went. Set what has
   stuck to `archived` with `set_exercise_status` instead of leaving it around.

## What makes a good exercise

- **Start from real mistakes.** The briefing names confusions such as
  "la puerta → el retraso". Build minimal pairs for exactly those.
- **Use vocabulary the learner knows.** Filter `search_vocabulary` by `topic`
  or `level` rather than dragging in new words.
- **`explanation` is where the learning happens.** It holds the why, not the
  solution. "Grund/Ursache → por" is good; "The answer is por" is worthless.
- **6 to 12 items per set.** More does not get practised in one sitting.
- **One topic per set.** "Por vs. para" yes, "mixed grammar" no.

## Item types

| Type | Required fields | Note |
| --- | --- | --- |
| `choice` | `options` (2–6), `answer` | `answer` must be exactly one of the `options`. Only exact hits count. |
| `cloze` | `prompt` with `___`, `answer` | Accents don't matter, one typo counts as "almost right". |
| `translate` | `prompt`, `answer` | Also give `alternatives` when several phrasings are correct. |

For `cloze` and `translate` a **mixed-up word** is not forgiven — "gracias para
tu ayuda" counts as wrong, a typo like "gracias pro tu ayuda" as almost right.
That is precisely what the exercise is meant to test.

## Important

- Never write to `events` directly — the log belongs to the app.
- `create_exercise` validates strictly and names the reason for a rejection.
  Read the error and fix the item; don't work around the schema.
- If the stack isn't running: `docker compose up -d` in the project directory.

Structure and data model: [ARCHITECTURE.md](ARCHITECTURE.md).
