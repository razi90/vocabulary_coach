# Vocabulary Coach — Spanish & English

Learn Spanish or English with flashcards, conjugation drills, grammar
exercises and a daily lesson. A built-in coach reads each learner's mistakes and writes
matching exercises, lessons and feedback, using a language model through the
learner's own OpenRouter or OpenCode Zen API key.

The app speaks German — it is built for German-speaking learners. Code,
comments and documentation are English.

## Courses

| Course | Content |
| --- | --- |
| 🇪🇸 Spanish | 608 words, 44 verbs in 6 tenses, 58 grammar items (ser/estar, por/para, articles, prepositions) |
| 🇬🇧 English | 779 words incl. 36 false friends, 44 verbs in 6 tenses, 52 grammar items aimed at German speakers (Present Perfect vs. Simple Past, since/for, Simple vs. Progressive, some/any, in/on/at, false friends) |

Learners pick a course when they register and can switch any time in the Coach
tab. Progress is kept per course: cards, answers, exercises, lessons and coach
runs of the other course stay as they are. The coach, the video search and the
subtitles follow the current course.

- **Backend:** Spring Boot 4 (Java 21), Spring Security, JDBC, Flyway, Postgres 17
- **Frontend:** plain HTML/JS in [web/](web/), no build step
- **Accounts:** email and password; each learner has their own progress

## Getting started

```bash
cp .env.example .env
# fill in at least APP_ENCRYPTION_KEY, ADMIN_EMAIL, ADMIN_PASSWORD
docker compose up -d
```

Open `http://localhost:8080` and log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
On first start the server creates the schema and mirrors the learning content
of both courses into the database.

Then open the **Coach** tab, pick a provider and model, paste an API key, and
give the coach an order.

```bash
docker compose up -d --build    # after backend changes
docker compose logs -f app      # follow the log
docker compose down             # stop (data stays in the volume)
docker compose down -v          # stop and wipe all learning state
```

Changes under `web/` need no rebuild: the folder is mounted into the
container, a browser reload is enough.

## Configuration

| Variable | Meaning |
| --- | --- |
| `APP_ENCRYPTION_KEY` | **Required.** 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts the learners' API keys. If it changes, everyone has to enter their key again. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Credentials for the first account. Used only while that account has no password; change it in the app afterwards. |
| `REGISTRATION_CODE` | Invite code for new accounts. Empty: registration is closed. |
| `YOUTUBE_API_KEY` | YouTube Data API v3 key, so the coach can find videos for lessons (see below). Empty: only links the learner pastes. |
| `POSTGRES_PASSWORD` | Database password, defaults to `voco`. Postgres publishes no port. |
| `APP_BIND` | Interface the app listens on, default `127.0.0.1`. |
| `COOKIE_SECURE` | `true` as soon as the app is served over HTTPS. |
| `COACH_MAX_STEPS` | Model round trips per coach run, default 25. |

## The coach

The coach runs on the server. A learner clicks an order in the Coach tab —
*Neue Übungen*, *Tageslektion*, *Feedback zu Abgaben* or a free-text order —
and the server runs a tool-calling loop against the chosen model:

1. The model gets the coach instructions
   ([system-prompt.md](backend/src/main/resources/coach/system-prompt.md)) and
   the order.
2. It calls tools — `get_briefing`, `search_vocabulary`, `create_exercise`,
   `create_lesson`, `give_feedback`, … ([tools.json](backend/src/main/resources/coach/tools.json)).
3. Every step is stored in `coach_runs` and appears live in the app; exercises
   and lessons show up in their tabs immediately.

`create_exercise` validates strictly. A rejected item goes back to the model
with the reason, and the model fixes it in the next round.

**Providers.** Both speak the OpenAI Chat Completions format with tool calling
and route one key to many models:

| Provider | Key | Models offered |
| --- | --- | --- |
| [OpenRouter](https://openrouter.ai/keys) | `sk-or-…` | All models that support tool calling |
| [OpenCode Zen](https://opencode.ai/auth) | Console API key | All paid chat models (Zen's free models work only inside OpenCode) |

The model must support tool calling. Small models tend to produce more
rejected items. The run log shows that, and each run's token count is listed
alongside it.

**API keys** are encrypted with AES-256-GCM before they reach the database,
bound to the learner's id, and never sent back to the browser — the app shows
only the last four characters. Costs go to the learner's own account at the
provider.

### Videos in the daily lesson

The listening part is a YouTube video. The coach finds one with
`search_youtube` (YouTube Data API) or takes a link the learner pasted into
the hint field. Every video ID is checked against YouTube before the lesson
is saved.

**Getting the API key.** In the [Google Cloud Console](https://console.cloud.google.com/):
create a project, enable *YouTube Data API v3*, create an API key under
*Credentials* and restrict it to that API. Put it in `.env` as
`YOUTUBE_API_KEY`. The free quota is 10 000 units a day; one search costs
about 100, so roughly 100 lesson searches a day for the whole server.

**The model cannot watch the video**, so the listening part comes in two kinds:

- **With questions.** The coach reads the Spanish subtitles
  (`get_video_transcript`) and writes multiple-choice questions about what is
  actually said. The app grades them at once. The server refuses questions
  for a video whose transcript the coach did not read in the same run, so
  invented questions cannot slip through.
- **Open task.** Without subtitles, the learner writes in Spanish what they
  understood. The submission waits for feedback like a writing task.

There is no official way to read another channel's subtitles. The app reads
them from the public watch page, best effort. YouTube often shows its bot
check to servers in data centers. A cloud or VPS server will then mostly get
open tasks; a server on a home connection usually gets the subtitles.

## Accounts and security

- Email and password, hashed with bcrypt. Sessions are stored in Postgres
  (Spring Session), so a restart does not log anyone out.
- After ten wrong passwords an email is locked for fifteen minutes.
- CSRF protection on every write: the token travels in the `XSRF-TOKEN` cookie
  and comes back as the `X-XSRF-TOKEN` header.
- Every query is scoped to the logged-in learner; the coach's tools get the
  learner's id from the server, never from the model.

Data from before multi-user (the Node version) belongs to the first account.
Flyway detects the existing schema, baselines at V4 and migrates from there.

**Running it for others.** Put an HTTPS reverse proxy (Caddy, nginx,
Cloudflare Tunnel) in front, set `COOKIE_SECURE=true`, and hand out the
`REGISTRATION_CODE`. Keep `APP_BIND=127.0.0.1` if the proxy runs on the same
machine.

## Development without Docker

Requirements: Java 21 and a Postgres with the `unaccent` extension.

```bash
cd backend
DATABASE_URL=jdbc:postgresql://localhost:5432/voco PGUSER=voco PGPASSWORD=voco \
APP_ENCRYPTION_KEY=$(openssl rand -base64 32) \
ADMIN_EMAIL=me@example.com ADMIN_PASSWORD=change-me-please \
./mvnw spring-boot:run
```

The backend serves `../web/` as static files, so frontend edits show up on reload.

**Learning content** (`web/src/courses/<course>/deck.js`, `conjugate.js`,
`grammar.js`, plus `course.js` with the course's metadata) is the source; the
browser loads it directly. The backend reads a JSON export of it.
After editing the content, regenerate the export (the Docker build does this
by itself):

```bash
node tools/export-content.js
```

**Tests:**

```bash
cd backend
./mvnw test
```

The integration test starts Postgres with Testcontainers when Docker is
available. Without Docker, point it at an empty database:
`TEST_DATABASE_URL=jdbc:postgresql://localhost:5432/voco_test TEST_DATABASE_USER=voco ./mvnw test`.
Without either, it is skipped.

## Looking into the database

```bash
docker compose exec db psql -U voco -d voco

\dv                                           -- all analysis views
SELECT id, email FROM users;
SELECT * FROM v_summary WHERE user_id = 1;                    -- one row per course
SELECT * FROM v_vocab_mistakes WHERE user_id = 1 AND course = 'en' ORDER BY wrong DESC LIMIT 10;
SELECT task, status, model, error FROM coach_runs ORDER BY started_at DESC LIMIT 5;
```

## Backup

```bash
docker compose exec -T db pg_dump -U voco voco > backup.sql
docker compose exec -T db psql -U voco -d voco < backup.sql   # restore
```

Back up `APP_ENCRYPTION_KEY` too — without it the stored API keys are useless
(everything else stays readable).

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md).

## License

MIT — see [LICENSE](LICENSE).
