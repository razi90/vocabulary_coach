# Architecture

```
                    Docker network
                 ┌──────────────────────────┐
Browser ──HTTP──>│ Node server ──┐          │
                 │               ├──> Postgres
Agent ──stdio──> │ MCP server ───┘          │
                 └──────────────────────────┘
```

Everything runs in containers; only port 8080 is open to the outside. The MCP
client starts `mcp/run.sh`, which goes into the running app container via
`docker exec` (or starts a container of its own if it has to) and pipes stdio
through.

The MCP server deliberately bypasses the Node server and talks to Postgres
directly: an agent should be able to work even when nobody has the app open.

## Files

| File | Responsibility |
| --- | --- |
| `db/migrations/*.sql` | Schema and analysis views. Applied at startup, one transaction per migration. |
| `server/db.js` | Connection, migrations, mirroring the learning content into the database. |
| `server/store.js` | Every SQL access of the application, in one place. |
| `server/briefing.js` | Phrases the analysis as text. Computes nothing — the views do that. |
| `server/server.js` | HTTP API, serving the app, SSE for live updates. |
| `mcp/server.js` | JSON-RPC over stdio, no SDK. The agent's tools. |
| `mcp/run.sh` | Starts it in the container and pipes stdio through. Output goes to stderr only. |
| `server/mcp-http.js` | The same server over HTTP at `/mcp`, optionally with a bearer token. |
| `mcpb/` | Sources of the `.mcpb` extension for Claude Desktop / Cowork. |
| `src/store.js` | Browser-side access to the API. No local storage any more. |
| `src/text.js` | Normalization and answer grading. Runs in the browser **and** in Node. |
| `src/packs.js` | Schema and validation of exercise sets. Likewise in both worlds. |
| `src/drill.js` | Generic drill flow, without DOM. |
| `src/lesson.js` | Daily lesson: video, writing field, speech recognition. |
| `server/lessons.js` | Creating and validating lessons, including YouTube verification. |
| `src/app.js` | UI. The only file that knows the DOM. |
| `src/deck.js` `conjugate.js` `grammar.js` | Learning content as source. |

## Why events

`events` is append-only: one row per answer, with timestamp, kind, right/wrong
and what was actually typed. Everything else is derived from it.

There are two reasons for that. First, the history used to live as a `history`
array on every card, grew without bound and made up roughly 96 % of the stored
state. Second, the typed answer is the only way to detect confusions —
`v_vocab_mistakes` connects the wrong input with the word that was actually
meant.

## One definition of "weakness"

Everything derived sits in views (`v_vocab_mistakes`, `v_conjugation_*`,
`v_grammar_accuracy`, `v_exercise_results`, `v_summary`). App, HTTP API and MCP
read the same views. There is no second place where "stubborn" or "weak" is
defined.

## Live updates

A trigger on `exercises` sends `pg_notify`. The Node server listens via
`LISTEN` and forwards it as a server-sent event. When an agent creates an
exercise, the "Übungen" tab marks itself — no reload.

## Extending

**New item type:** add an entry to `ITEM_TYPES` in `src/packs.js`
(`normalize`, `validate`, `check`) and a renderer in `PACK_RENDERERS` in
`src/app.js`. The tool description in the MCP server names the types
automatically.

**New kind of drill:** `src/drill.js` provides the queue, grading, progress and
prioritization. The exercise-set flow in `app.js` is the model to follow.

**Schema change:** a new numbered file in `db/migrations/`. Never change an
existing migration.

**Note:** the vocabulary, conjugation and grammar drills still run on three
separate, largely identical loops instead of on `DRILL`. Mechanically
convertible, not done so far.
