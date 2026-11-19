# Vocabulary Coach — notes for agents

Language learning app for German speakers, with two courses: Spanish and
English. Spring Boot 4 backend (`backend/`), plain JS frontend (`web/`),
Postgres. Several learners, each with their own progress per course; a
built-in coach calls an LLM (OpenRouter or OpenCode Zen) with the learner's own
API key.

The app's interface and all explanations are German, the exercises themselves
in the course language. Code, comments and docs are English.

Structure and data model: [ARCHITECTURE.md](ARCHITECTURE.md).

## Working on the code

- Build and test: `cd backend && ./mvnw test`. The integration test needs
  Docker (Testcontainers) or `TEST_DATABASE_URL` pointing at an empty Postgres.
- Frontend and content: `node --test web/test/` (no install). Browser tests:
  `cd e2e && npm test` against the running stack (`docker compose up -d`).
  After a UI change, run both; a new feature gets a spec in `e2e/tests/`.
- Every learner-owned table has `user_id` and `course`. Every query filters by
  both; get the `Learner` from `UserAccounts.currentLearner()` in controllers
  and pass it explicitly everywhere else.
- Never write to `events` other than by appending — the log is the truth.
- Schema changes go in a new Flyway migration; never edit an existing one.
- Exercise validation exists twice: `web/src/packs.js` (browser) and
  `PackValidator.java` (server). Change both, and extend `PackValidatorTest`.
- Course content lives in `web/src/courses/<course>/`. After editing a
  `deck.js`, `conjugate.js` or `grammar.js`, run `node tools/export-content.js`
  and commit the regenerated `content.json`. Deck terms are card ids: they must
  be unique within a course.
- Nothing language-specific in shared code: in the browser use `COURSE`, on the
  server `Course`.
- The coach's behavior lives in `backend/src/main/resources/coach/`:
  `system-prompt.md` (shared instructions with placeholders), `course-<id>.md`
  (per course) and `tools.json` (tool descriptions, which the model reads —
  they are German). Handlers are in `CoachTools`. `CoachPromptTest` checks
  that every course's prompt is complete.

## What makes a good exercise

This is also what the coach's system prompt asks for. Keep the two in step.

- **Start from real mistakes.** The briefing names confusions such as
  "la puerta → el retraso" or "to become → to get". Build minimal pairs for
  exactly those.
- **Use vocabulary the learner knows.** Filter by `topic` or `level` rather
  than dragging in new words.
- **`explanation` is where the learning happens.** It holds the why, not the
  solution. "Grund/Ursache → por" is good; "The answer is por" is worthless.
- **6 to 12 items per set. One topic per set.**

## Item types

| Type | Required fields | Note |
| --- | --- | --- |
| `choice` | `options` (2–6), `answer` | `answer` must be exactly one of the `options`. Only exact hits count. |
| `cloze` | `prompt` with `___`, `answer` | Accents don't matter, one typo counts as "almost right". |
| `translate` | `prompt`, `answer` | Also give `alternatives` when several phrasings are correct. |

For `cloze` and `translate` a **mixed-up word** is not forgiven — "gracias para
tu ayuda" counts as wrong, a typo like "gracias pro tu ayuda" as almost right.
Items default to the course language (`lang`, `to`).
