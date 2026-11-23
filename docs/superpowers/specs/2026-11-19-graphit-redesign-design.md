# Graphit redesign: calm look, four sections, four new features

Status: approved; the owner asked to build it without further questions
Date: 2026-11-19

## Why

A UI/UX review found the app clean and consistent but dated: emoji as icons,
the same bordered-and-shadowed card for everything, system font with many
tiny uppercase labels, a narrow column on desktop, nine sections behind a
hamburger menu on phones. The home screen only covers vocabulary, the
session end is bare, statistics reads like a developer page, and the coach
screen mixes requests with account settings.

The owner wants a **calm and minimal, modern** look, picked **"Graphit"**
from three mockups: neutral greys, crisp type, thin borders, small
monochrome icons, one accent colour per course (in the spirit of Linear or
Notion). Together with the look, the structure is reorganised and four
features are added.

## Goals

1. The Graphit look across every screen, light and dark, including the
   login page.
2. Four sections instead of nine: **Heute, Üben, Coach, Fortschritt**.
   Bottom tab bar on phones, left side navigation on desktop.
3. **Heute** shows everything due today: vocabulary, today's lesson, new
   coach exercise sets, due grammar.
4. A **settings** page behind a gear in the top bar: daily goal, account and
   password, coach provider/model/key, data export. The course name opens a
   course menu of its own.
5. Better **session end** (missed words, a next step) and **Fortschritt**
   (no developer text, no empty boxes).
6. Four new features:
   - **Word detail** sheet
   - **Pronunciation** (text to speech)
   - **Practice calendar**
   - **First-run welcome**

## Non-goals

- No framework, no build step. The frontend stays plain static files that
  `docker compose` mounts live and the service worker caches.
- No backend changes unless a feature genuinely cannot be built otherwise
  (none is expected: see "Data" below).
- No change to grading, spaced repetition, the coach, course content or the
  event log.
- No gamification beyond what exists (streak, daily goal).

## Anti-goals (a failure even if it technically works)

- Losing offline use or breaking the installed home-screen app.
- Any regression in a trainer: answers judged differently, cards scheduled
  differently, events logged differently.
- Clutter creeping back: more than one primary action per screen, colour
  used for decoration, uppercase micro labels.
- Anything language-specific in shared code (project rule: use `COURSE`).
- Existing learners being sent through the welcome.

## Approaches considered

1. **Rework the existing frontend in plain JS (chosen).** New stylesheet
   with design tokens, self-hosted font and an inline SVG icon sprite,
   `index.html` reorganised into the four sections, trainer logic kept and
   moved out of the 1,550-line `app.js` into smaller files where it is
   touched, new files for the features. Keeps the no-build setup, live
   reload, content export and tests.
2. **Component framework (Preact/Svelte + Vite).** Easier to grow later,
   but a rewrite of ~3,600 working lines, adds a build step, and breaks
   live reload, the content export's vm loading and the test loader.
   Rejected: too much risk for four sections.

Built in **three stages**, each shippable on its own: look, structure,
features. The owner can stop after any stage.

## Design

### Visual language (stage 1)

- **Tokens** on `:root` in `style.css`, redefined for dark mode under
  `prefers-color-scheme: dark`. Neutral greys for surfaces/text/borders;
  `--accent` and `--accent-soft` set per course; `--good` and `--bad` for
  right/wrong only.
- **Surfaces:** page `#fafafa` (dark: near-black), panels white with a 1px
  border (`#ececec`), radius 10–14px, shadow only for floating layers
  (sheet, dialogs). No beige, no shadows on ordinary cards.
- **Type:** Inter, self-hosted as woff2 in `web/fonts/` (OFL licence file
  next to it), `font-display: swap`, cached by the service worker. Scale:
  page title 26–28px bold with tight tracking; section label 12–13px
  semibold grey in sentence case (no uppercase); body 14–15px;
  secondary 12–13px grey. Form fields stay at 16px+ on touch screens
  (existing rule).
- **Accent per course:** a new field in `courses/<id>/course.js`
  (`accent`, plus a dark-mode variant). `boot.js` sets the CSS variables
  when it applies the course. Spanish: orange (around `#e0531f`), English:
  blue (around `#2b59c3`). Used for the primary button, progress, active
  tab and focus ring only.
- **Icons:** one inline SVG `<symbol>` sprite in `index.html`, line style
  (Lucide-derived, ISC licence noted in a comment), 20–22px, `currentColor`.
  Every emoji used as an icon goes; the course flag and the streak flame
  stay, since they are content, not chrome.
- **Motion:** short (150–220ms) and only for state changes (sheet slide,
  tab change, card flip). All of it off under `prefers-reduced-motion`.
- **Login and registration** get the same tokens and type.

Stage 1 restyles the existing nine sections without moving anything, so it
can ship alone.

### Structure (stage 2)

**Navigation.** Four sections. Phones (≤ 860px): bottom tab bar, fixed,
with safe-area padding; the hamburger and drawer go. Desktop: a left
sidebar (about 210px) with the course button at the top and the four
entries; content up to about 960px, using two columns where a screen has
two parts. The top bar shows the section title and the streak; on phones
the course button sits there too.

**Heute** (replaces Start; lesson moves under it):
- Vocabulary panel: due/new counts, today's progress (done / goal,
  accuracy), the one primary button ("Weiterlernen", or "Sitzung starten"
  before the first card of the day, or "Trotzdem weiterlernen" when the goal
  is reached), and the direction toggle as a compact two-way switch.
- "Außerdem heute": a list built from what exists — today's lesson (if
  any, with its parts and what is done), new coach exercise sets not yet
  practised, and grammar topics with items recently answered wrong (grammar
  has no due dates; this adds no scheduling). Each row opens the matching
  screen. Empty list: one calm line, not an empty box.
- The lesson screen itself is unchanged in function, restyled, reached from
  that row (and a back arrow returns to Heute).
- The daily goal slider leaves this screen (welcome and settings).

**Üben**: a list in three groups — Trainer (Vokabeln starts a vocabulary
session directly, like the Heute button; Verben, Grammatik),
Vom Coach (exercise sets, newest first, with their status), Nachschlagen
(Wortliste). Each row opens the existing trainer start screen or list,
restyled. The verb and grammar option chips stay on their start screens.

**Coach**: the request box and the run history. Provider/model/key move to
settings; when the coach is not set up, the request box shows one line and
a button "Coach einrichten" that opens the coach part of settings,
instead of pale disabled buttons.

**Fortschritt**: practice calendar (see features), a short week summary,
vocabulary maturity as one stacked bar with three numbers, a short list of
the hardest words (from the existing weakness data in the browser; tap
opens the word detail), and verb/grammar accuracy shown only once there
are attempts, with their existing "Häufige Fehler" and "Letzte Versuche"
lists folded underneath. A compact row keeps the overall numbers (answers in
total, 30-day accuracy, streak, consolidated cards). The hardest words are
ranked in the browser from `cards` and `events` (a tested pure helper), not
fetched from the server. Export and the "data lives in the database" text
move to settings.

**Course and settings are two controls** (changed after the first build:
one button that looked like a dropdown but opened the settings was confusing).
The course name in the top bar opens a small menu of the courses; picking one
switches right away (reloads into it). A gear next to the streak opens the
settings page:
- Lernen: daily goal (the direction stays a single value, switched on Heute)
- Coach: provider, model, API key (existing form and validation)
- Konto: email, change password, log out
- Daten: export progress (JSON), export learning report

**Session end** (vocabulary, verbs, grammar, exercise sets): the numbers
(cards, accuracy, streak) plus the words or items that went wrong in this
session (tap a word → word detail) and one suggested next step taken from
the Heute list ("Als Nächstes: Tageslektion") next to "Fertig".

**Grammar and exercise feedback** gets a clear headline ("Richtig" /
"Nicht ganz") above the explanation, with spacing.

### Features (stage 3)

**Word detail** — a sheet sliding up from the bottom (phones) or a
centred panel (desktop), opened from the word list, the session-end list
and the hardest-words list. Shows: term with speaker button, all meanings,
part of speech / level / topic as tags, the example sentence with its
German, how often answered right out of how often, when the card comes
back (or "neu"), and the last three typed answers that were wrong or almost
right, each with what it was confused with if that is another deck word.
All from the browser's existing `cards`, `events` and `DECK`; no new API.
Closes by swipe-down/tap outside/Escape; focus is trapped while open and
returns to the opener.

**Pronunciation** — a speaker button on the word detail, on the flashcard
(course-language side) and in word-list rows. Uses the browser's
`speechSynthesis` with `COURSE.speechLang`; picks a voice for that
language if one exists, otherwise hides the buttons (no broken button).
Reads only the course-language side and, in the word detail, the example
sentence on a second tap target. No server, no cost.

**Practice calendar** — in Fortschritt: the current month as a 7-column
grid (Monday first), one square per day, four intensity steps by number of
answers that day across all trainers (from `events`), today outlined,
future days blank. Arrows step to earlier months. Under it a week summary:
answers this week, percent right, days practised out of seven. Replaces
the 14-day bar chart. Squares have accessible labels ("12. November: 34
Antworten").

**First-run welcome** — shown once to an account with no answers in this
course and no `welcomeSeen` flag in its saved settings. Four short steps:
1. the language to learn (the courses from `/api/auth/config`, the current
   one preselected). Picking another switches the course and reloads; the
   welcome carries on there with step 2. Registration no longer asks for the
   language, so it is asked once, here.
2. the idea: a little every day; the coach builds exercises from your
   mistakes
3. the daily goal: Locker 10, Normal 20 (default), Intensiv 40
4. the four sections, one line each

Skippable at every step. Finishing or skipping sets `welcomeSeen` (in the
existing settings blob, no schema change) and lands on Heute. Learners with
answers in this course never see it. Opening a second course for the first
time does show it (the browser only knows the current course, and the daily
goal is per course anyway); it is one tap to skip.

### Pausing drills (added after the first build)

Leaving a drill pauses it instead of throwing it away: the ✕ (now "Pausieren"),
another section, a course switch, a reload or closing the app. The trainer's
start button then reads "Fortsetzen · 7 von 20" with "Neu beginnen" next to
it; Heute lists paused verb, grammar and exercise drills; Üben shows
"Pausiert". Answers are saved on the server as they happen, so only the rest
of the queue is kept - in this browser, per course, for the current day
(tomorrow other cards are due). The "Die laufende Übung wird beendet" prompt
is gone.

### Data

Everything the features need is already in the browser after startup:
`cards`, `events` (loaded in full by `STORE.allEvents()`), `state`
(settings blob, gains `welcomeSeen`), `DECK`, `COURSE`. No API or schema
change is planned. If one turns out necessary, it is a separate,
explicit decision.

### Code organisation

- `style.css` is rewritten around the tokens (it may be split into a few
  files if that keeps it readable; the service worker list follows).
- `app.js` is split along the lines the work touches: navigation/shell,
  Heute, vocabulary session, verb session, grammar session, exercise sets,
  word list, Fortschritt, settings. New files for the word sheet, speech,
  calendar and welcome. Pure helpers (calendar bucketing, per-word history,
  the Heute list) live where Node tests can load them, like `text.js`.
- `boot.js` loads the new files in order and sets the course accent.
- `sw.js`: new files and the font in `ASSETS`, `VERSION` bumped every stage.

### Testing

- Node tests (`web/test/`): the new pure helpers — calendar bucketing
  (days, months, intensity steps), per-word history (right/total, last
  typos, confusions), the Heute list (what appears when).
- Browser tests (`e2e/`): existing specs updated to the new navigation
  (selectors through `openTab`/helpers, so most specs change little); new
  specs per feature (word sheet opens with the right history, speaker
  hidden without a voice, calendar shows today's answers, welcome shows
  once for a new account and never for one with answers, settings save the
  daily goal); the phone spec checks the tab bar instead of the drawer.
- Each stage ends with both suites green and screenshots of every screen
  at phone and desktop size, light and dark, for the owner to check.

## Decisions made after the builder check (owner delegated them)

- Grammar on Heute: only topics with recent wrong answers; no due dates.
- Welcome: per course, as above.
- Hardest words: computed in the browser.
- Direction: one value, on Heute only.
- Üben → Vokabeln: starts a session.
- Fortschritt keeps the overall numbers and the verb/grammar mistake lists.

## Left to the builder

- Exact colour values, spacing scale and icon drawings within the
  Graphit direction (the mockups are the reference, not a spec).
- Whether `style.css` stays one file or becomes a few.
- How exactly `app.js` is split, as long as behaviour and logged events
  stay identical.
- Copy wording in German for new texts, following the existing tone.
