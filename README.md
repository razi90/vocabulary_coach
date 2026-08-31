# Español — Vocabulary Coach

Learn Spanish with flashcards, conjugation drills and grammar exercises. The
learning state lives in Postgres. An agent reads it through an MCP server,
spots weaknesses and creates matching exercises that show up in the app
immediately.

The app itself speaks German — it is built for a German-speaking learner of
Spanish. Code, comments and documentation are English.

## Getting started

```bash
docker compose up -d
```

Open `http://localhost:8080`. On first start the server creates the schema and
mirrors the learning content (608 words, 44 verbs, 58 grammar items) into the
database.

Useful commands:

```bash
docker compose up -d --build    # after code changes
docker compose logs -f app      # follow the log
docker compose down             # stop (data stays in the volume)
docker compose down -v          # stop and wipe the learning state
```

`docker compose start` only works if the containers already exist — after a
`down`, always use `up -d`.

## Configuration

All settings are optional; without a `.env` the stack runs locally on the
defaults from [docker-compose.yml](docker-compose.yml).

```bash
cp .env.example .env
```

| Variable | Meaning |
| --- | --- |
| `POSTGRES_PASSWORD` | Database password, defaults to `voco`. Postgres publishes no port and is reachable only inside the Docker network. |
| `MCP_TOKEN` | Bearer token for the `/mcp` endpoint. Empty means no token — only defensible while it listens on `127.0.0.1`. |
| `MCP_PORT` | Second listener serving `/mcp` exclusively. If set, the server refuses to start without an `MCP_TOKEN`. |

## MCP server for the agent

### Option A: Cowork / Claude Desktop (.mcpb extension)

Cowork reaches local MCP servers through the desktop app. Build the bundle
once:

```bash
npx @anthropic-ai/mcpb pack mcpb vokabeltrainer.mcpb
```

Install it: open Claude → Settings → Extensions → Advanced settings →
*Install Extension…* → pick `vokabeltrainer.mcpb`. Repack after changes to the
server.

The bundle contains no server of its own; it pipes stdio into the running
container (2 KB, no `node_modules`). It looks for Docker in the usual places on
its own — processes started from a GUI do not inherit `/usr/local/bin` — and
starts the container if it is stopped. If Docker is missing entirely, you get a
readable message instead of a silent failure.

Prerequisite: `docker compose up -d` once, so the container exists.

The bundle is unsigned, which is normal for a locally installed extension.
Signing would be `npx @anthropic-ai/mcpb sign --self-signed`.

### Option B: Claude Code (stdio)

The MCP server runs **inside the container**, on the same Docker network as the
database. The host needs neither Node nor `npm install`, and the Postgres port
stays closed.

```json
{
  "mcpServers": {
    "vokabeltrainer": {
      "command": "./mcp/run.sh"
    }
  }
}
```

That is what [.mcp.json](.mcp.json) in this repo does; a client that resolves
the command relative to its own working directory needs the absolute path to
`mcp/run.sh` instead.

[mcp/run.sh](mcp/run.sh) picks the route itself:

- if the app container is running, it goes in via `docker exec` — no new container;
- otherwise it starts one of its own, bringing up the database if needed.

Either way it works regardless of the client's working directory. The app does
not have to be open.

### Option C: over HTTP (for clients that only accept a URL)

Same server, same tools — only a different transport. It hangs off the running
app container, so there is nothing extra to start:

```
http://localhost:8080/mcp
```

In Claude Code:

```bash
claude mcp add --transport http vokabeltrainer http://localhost:8080/mcp
```

In a config file:

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

For a client that demands HTTPS and does not run on this machine, there is an
optional tunnel:

```bash
echo "MCP_TOKEN=$(openssl rand -hex 24)" >> .env
echo "MCP_PORT=8081" >> .env
docker compose --profile tunnel up -d       # cloudflared, public HTTPS URL
docker compose logs tunnel | grep trycloudflare
```

`MCP_PORT` starts a second listener that serves **only** `/mcp` — the app and
`/api` stay local. Only that port is tunnelled. Without an `MCP_TOKEN` the
server refuses to start, because a public endpoint without a token amounts to
open write access to the database.

**With a token** (required as soon as the port is no longer localhost-only):

```bash
echo "MCP_TOKEN=$(openssl rand -hex 24)" > .env
docker compose up -d app
```

Then pass `--header "Authorization: Bearer <token>"` in the client. Without
`MCP_TOKEN` the endpoint is open — only defensible as long as it listens on
`127.0.0.1` exclusively.

### Tools

| Tool | Purpose |
| --- | --- |
| `get_briefing` | Learning state as Markdown, with a concrete assignment. The entry point. |
| `get_weaknesses` | The same analysis structured: metrics, vocabulary mistakes with confusions, conjugation by form/tense/person, grammar by category. |
| `query_events` | Raw answer log, including what was actually typed. |
| `search_vocabulary` | Search the vocabulary by topic, level, part of speech — with per-word learning state. |
| `list_exercises` | Existing exercise sets and their results. |
| `create_exercise` | Create an exercise set. Appears in the app immediately. |
| `set_exercise_status` | `ready` (visible), `draft` (hidden), `archived`. |
| `delete_exercise` | Remove it; logged answers remain. |

Item types: `choice`, `cloze` (gap text with `___`), `translate`. For `cloze`
and `translate`, accents are ignored and a typo counts as "almost right" — a
mixed-up word does not, otherwise the exercise would wave through the very
mistake it tests. `explanation` is for the why, not the solution.

Invalid items are rejected with a reason; the validation is the same one the
app uses ([src/packs.js](src/packs.js)).

## Daily lesson

Via `create_lesson` the coach sets up a lesson for the day: a YouTube video
with comprehension questions, a writing assignment and a speaking topic. It
appears in the "Lektion" tab without a reload.

Listening is graded immediately. Writing and speaking the app cannot judge —
the submission is stored, the coach picks it up with `get_pending_feedback` and
answers through `give_feedback`. The response then shows up under the task.

For speaking the app uses the browser's speech recognition (Spanish). Without
microphone permission, or if the browser blocks it, the text can be typed
instead.

Every YouTube ID is verified against YouTube on creation — a made-up ID is
rejected rather than ending up as a dead frame in the app.

## Looking into the database

```bash
docker compose exec db psql -U voco -d voco

\dv                              -- all analysis views
SELECT * FROM v_summary;
SELECT * FROM v_vocab_mistakes ORDER BY wrong DESC LIMIT 10;
SELECT * FROM v_grammar_accuracy ORDER BY accuracy;
```

## Security

The service has **no authentication**. This is a single-user tool meant to run
on your own machine: the app is published on `127.0.0.1:8080` only, and
Postgres publishes no port at all — it is reachable inside the Docker network
only. For `psql`: `docker compose exec db psql -U voco -d voco`.

To reach it from a phone on the same Wi-Fi, change `"127.0.0.1:8080:8080"` to
`"8080:8080"` for the `app` service in [docker-compose.yml](docker-compose.yml).
Everyone on that network can then read and change the learning state.

Set a password with `POSTGRES_PASSWORD=… docker compose up -d` or via `.env`.

## Backup

```bash
docker compose exec -T db pg_dump -U voco voco > backup.sql
docker compose exec -T db psql -U voco -d voco < backup.sql   # restore
```

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md).

## License

MIT — see [LICENSE](LICENSE).
