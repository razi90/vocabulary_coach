# Architecture

```
                         Docker network
                 ┌────────────────────────────────────┐
Browser ──HTTPS─>│ Spring Boot ───────────> Postgres  │
  (web/)         │   │  ▲ LISTEN/NOTIFY               │
                 │   │  └──── server-sent events ──>  │ (back to the browser)
                 │   └──HTTPS──> OpenRouter / OpenCode Zen
                 └────────────────────────────────────┘
```

One Spring Boot application serves the static frontend, the JSON API and the
coach. Only port 8080 is published, by default on `127.0.0.1`.

## Layout

| Path | Responsibility |
| --- | --- |
| `web/` | Frontend: plain HTML/JS/CSS, served as static files. |
| `web/src/boot.js` | Asks the server for the learner's course, loads that course's content, then the app. |
| `web/src/courses/<course>/` | Course content as source: `course.js` (metadata), `deck.js`, `conjugate.js`, `grammar.js`. Same interface in every course. |
| `web/src/text.js` | Normalization and answer grading (browser only). |
| `web/src/packs.js` | Exercise-set schema, validation and checking in the browser. |
| `web/src/store.js` | Browser access to the API: CSRF header, 401 → login, live updates. |
| `web/src/coach.js` | Coach tab: settings, orders, run history, account. |
| `web/src/auth.js` | Login and registration page. |
| `tools/export-content.js` | Turns the content into `content.json` for the backend. |
| `backend/.../db/migration/` | Flyway migrations: schema and analysis views. |
| `backend/.../content/ContentSync` | Mirrors the content into the database at startup. |
| `backend/.../learning/Course`, `Learner` | The courses and their wording; a learner = user + course. |
| `backend/.../learning/LearningStore` | Every SQL access to a learner's state, always by user and course. |
| `backend/.../learning/PackValidator` | Exercise-set validation; same rules as `web/src/packs.js`. |
| `backend/.../learning/Briefing` | Phrases the analysis as Markdown. Computes nothing. |
| `backend/.../lessons/LessonService` | Daily lessons, submissions, feedback. |
| `backend/.../lessons/YouTube` | Video search (Data API), existence check (oEmbed), subtitles (watch page, best effort). |
| `backend/.../auth/` | Accounts, Spring Security setup, login throttle, first-account bootstrap. |
| `backend/.../coach/` | Providers, LLM client, key encryption, tools, the run loop. |
| `backend/.../resources/coach/` | `system-prompt.md` (shared), `course-<id>.md` (per course), `tools.json`. |
| `backend/.../web/ApiController` | The app's HTTP API. |
| `backend/.../web/LiveUpdates` | LISTEN on Postgres, push server-sent events per learner. |

## Learners and courses

A learner is a user in one course (`Learner(userId, course)`). Every table a
learner writes to carries `user_id` and `course`: `settings`, `cards`,
`events`, `exercises`, `lessons` (submissions hang off their lesson),
`coach_runs`. Content tables (`vocabulary`, `verbs`, `grammar_items`,
`labels`) are keyed by course. `users.course` is the course the learner is in
right now; switching changes only that column.

The principal's name in the session is the numeric user id.
`UserAccounts.currentLearner()` adds the current course; every
`LearningStore` and `LessonService` method takes the learner as its first
argument. There is no learner query without both.

In the frontend, `COURSE` (from `courses/<id>/course.js`) carries everything
language-specific: `lang` attributes, flag, name, speech recognition, default
tenses. Static text in `index.html` uses `data-course-lang`,
`data-course-text` and `data-course-placeholder`, filled by `boot.js`. The
direction codes `es-de`/`de-es` in the stored state mean "course language →
German" and back, in every course.

## Why events

`events` is append-only: one row per answer, with timestamp, kind, right/wrong
and what was actually typed. Everything else is derived from it. The typed
answer is the only way to detect confusions — `v_vocab_mistakes` connects the
wrong input with the word that was actually meant.

## One definition of "weakness"

Everything derived sits in views (`v_vocab_mistakes`, `v_conjugation_*`,
`v_grammar_accuracy`, `v_sentence_mistakes`, `v_exercise_results`,
`v_summary`), each with a `user_id` column. The API, the briefing and the coach
read the same views. There is no second place where "stubborn" or "weak" is
defined.

## The coach

`CoachRunner` starts a run on a virtual thread and returns at once. The loop:

1. Send the system prompt, the order and the tool definitions to the model.
   Both are worded for the learner's course: `system-prompt.md` gets the
   course part (`course-<id>.md`) and its `{{placeholders}}` filled, the tool
   texts get `{{sprache}}` & co. from `Course`. A placeholder left over stops
   the startup.
2. If the reply contains tool calls, run each through `CoachTools`, append the
   results (errors prefixed with `FEHLER:`), store the step, repeat.
3. A reply without tool calls is the summary; the run is done.

Each run remembers which video transcripts it fetched (`CoachTools.Context`).
`create_lesson` accepts comprehension questions only for those videos; the
transcript is stored with the lesson as the answer key for feedback on open
listening tasks and is stripped from what the browser gets.

Limits: `COACH_MAX_STEPS` round trips, ten minutes, one running job per
learner, tool results capped at 30 000 characters. Runs still marked as
running when the server starts are marked failed.

The client (`LlmClient`) is a small hand-written Chat Completions client on the
JDK HTTP client, not a framework abstraction: the key differs per learner and
request, and the loop needs to see and record each step.

## Live updates

Triggers on `exercises`, `lessons` and `coach_runs` call `pg_notify` with the
owner's id. `LiveUpdates` holds one connection that LISTENs and forwards each
notification as a server-sent event to that learner's open tabs only.

## Extending

**New course:** a folder `web/src/courses/<id>/` with the four files (same
interfaces as the others), the id in `boot.js`, `sw.js` and
`tools/export-content.js`, an entry in `Course`, a `course-<id>.md`, and a
migration adding the row to `courses`.

**New item type:** add it to `ITEM_TYPES` in `web/src/packs.js` (`normalize`,
`validate`, `check`), to `PackValidator` (same rules, plus a test), a renderer
in `PACK_RENDERERS` in `web/src/app.js`, and the enum in `coach/tools.json`.

**New coach tool:** a definition in `coach/tools.json` and a handler in
`CoachTools.register()`. The app refuses to start if one exists without the
other.

**New provider:** an entry in `Provider` — any OpenAI-compatible endpoint with
tool calling works — plus the check constraint on `coach_settings.provider`.

**Schema change:** a new `V<n>__name.sql` in `db/migration/`. Never change an
existing migration.

**Note:** the vocabulary, conjugation and grammar drills still run on three
separate, largely identical loops instead of on `DRILL`. Mechanically
convertible, not done so far.
