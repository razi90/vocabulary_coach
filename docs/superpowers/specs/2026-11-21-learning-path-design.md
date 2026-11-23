# Learning path: from a vocabulary trainer to a course

Status: the owner asked to build it without further questions ("just start")
Date: 2026-11-21

## Why

The app grew out of a vocabulary trainer, and its flow still is one. Read as
someone who wants to *learn* the language, it falls short:

- **No starting point.** The welcome asks for a language and a number of
  cards. New words come in deck order, so someone with A2 Spanish starts with
  "el hombre". Nothing finds out what a learner already knows.
- **No path.** The deck's level and topic tags are invisible. Heute is a
  counter of due and new cards; Üben is a toolbox. Nothing says what comes
  next or why.
- **Grammar is tested, never taught.** The explanation appears only after a
  wrong answer.
- **The rich parts sit behind the coach.** Listening, writing and speaking
  exist only when the coach (with the learner's own API key) builds them.
- **Fortschritt measures effort, not ability.** Practice days and hard words,
  never "you can now order in a café".

The owner wants the app to work for someone who **starts from zero** and for
someone who **wants to improve what they already know**.

## Goals

1. A **course path** per language: units grouped by level (A1, A2, B1), each
   named by what the learner can do afterwards. Every deck word belongs to
   exactly one unit.
2. Each unit is a short **sequence**: get to know the words, understand and
   practise one grammar topic or tense, pass a short **check**.
3. **Teaching before testing**: every grammar topic and tense on the path has
   a short explanation with examples, offered before its first drill.
4. **Placement** in the welcome: "Ich fange neu an" or "Ich kann schon
   etwas". The latter runs a short check per level and starts the learner
   at the first level they do not pass yet.
5. **Heute is today's plan**: the current unit at the top, then the steps in
   order (vocabulary with new words from the current unit, the unit's grammar,
   its check, then the coach's lesson and sets). One button starts the first.
6. A new section **Kurs** shows the whole path: levels, units, where the
   learner stands. It is the one memorable element of the redesign.

## Non-goals

- No backend change, no migration. The path's progress lives in the learner's
  state blob (`state.path`), like the daily goal does.
- No new scheduling: spaced repetition, grading and the trainers stay as they
  are. The path only decides *which* new words are offered.
- The coach does not learn about units yet (possible follow-up: export units
  to `content.json` and name the current unit in the briefing).
- No hard locks. Any unit can be opened, learned or checked at any time.

## Anti-goals

- Existing learners losing progress, or being pushed back to unit 1 with
  hundreds of words already learned.
- Placement answers polluting the event log with "mistakes" on words the
  learner was never taught (placement is not logged).
- Anything language-specific in shared code: units and explanations are
  course content in `web/src/courses/<id>/path.js`.
- More than one primary button per screen; decoration creeping into Graphit.

## Approaches considered

1. **A path module on top of the existing trainers (chosen).** Units are
   content (`courses/<id>/path.js`) that point at deck words (by level and
   topic), a grammar category or a tense. A pure module `path.js` derives
   status, today's plan, the check and the placement. The vocabulary session,
   grammar and verb trainers are reused unchanged in their mechanics.
2. **Hand-written lessons per unit** (dialogues, reading texts, new
   exercise types). Closer to a textbook, but a large amount of authored
   content for two languages that would duplicate what the coach generates.
   Possible later, on top of (1).
3. **Only reorganise the screens** (Heute, Üben) without a path. Cheaper,
   but leaves the core problem: nothing tells a learner where they are.

## Design

### Content: `web/src/courses/<id>/path.js`

`COURSE_PATH = { LEVELS, UNITS, GUIDES }`.

- `LEVELS`: per level a title and a can-do line ("Du kommst mit einfachen
  Sätzen durch den Alltag").
- `UNITS`, in order: `{ id, level, title, goal, topics, part?, focus? }`.
  Words = deck entries of that level whose topic is in `topics`, in deck
  order; `part: [k, n]` takes the k-th of n equal slices (for big topics such
  as verbs). `focus` is `{ kind: "grammar", id }` (a `GRAMMAR` category) or
  `{ kind: "tense", id }` (a `CONJUGATE` tense).
- `GUIDES`, keyed `grammar:<id>` / `tense:<id>`: title, a few short
  paragraphs (German) and examples (course language with German).

A content test checks that every deck word is in exactly one unit, that every
focus exists in the course, and that every focus has a guide.

### Logic: `web/src/path.js` (pure, tested)

- **Unit status**: `done` (check passed), `skipped` (placement or legacy),
  otherwise open. Step progress: words introduced / total; focus practised
  (guide seen and at least 8 attempts on that category or tense); check
  passed.
- **Current unit**: the learner's chosen unit (`state.path.focus`) if it is
  not done, else the first unit that is neither done nor skipped.
- **New words** are the current unit's not-yet-introduced words, in deck
  order, under the existing daily limit. Nothing else is offered as new.
- **Plan for Heute**: vocabulary (due + new), the focus (read guide / keep
  practising), the check (once all words are introduced), then
  `TODAY.items` (lesson, sets, grammar mistakes).
- **Check**: up to 8 words of the unit (multiple choice course language →
  German, typing German → course language for words already introduced) and
  up to 4 items of the focus (grammar items; for a tense, typed verb forms).
  Passed at 80 %. Answers are real answers: logged as `vocab`, `grammar` or
  `conj` events (with `mode: "check"` for vocabulary); they do not reschedule
  cards.
- **Placement**: per level 10 items (8 words as multiple choice, 2 grammar
  items from the level's focus topics). 7 of 10 passes the level and moves on;
  otherwise the learner starts at that level's first unit. Units of passed
  levels become `skipped`. Not logged.
- **Existing learners** (cards but no `state.path`): units whose words are all
  introduced count as skipped ("übernommen"), so they start where their words
  end.

### Screens

- **Navigation**: five sections, Heute · Kurs · Üben · Coach · Fortschritt.
- **Kurs**: a vertical line through the levels. Each level opens with its
  code set large ("A1") and its can-do line; each unit is a stop on the line
  (filled when done or skipped, ringed in the accent when current, hollow
  ahead) with its title and progress. Tapping a unit opens it.
- **Unit**: level and position, title, goal, then the three steps numbered
  (a real sequence) with their state, the unit's words as chips, and one
  primary button for the next step. Secondary: "Als Nächstes lernen" (makes it
  the current unit), "Ich kann das schon: Check machen".
- **Guide**: the explanation and examples, primary "Jetzt üben".
- **Check**: the item player, then a result: passed (unit done, next unit
  named) or not yet (score, what went wrong, what to repeat).
- **Heute**: the current unit as a header panel (level, title, three-step
  progress, opens the unit); "Dein Plan für heute" as a numbered list; one
  primary button for the first open step; today's numbers in one line; the
  direction switch stays.
- **Welcome**: language → where do you stand → daily goal → the sections;
  then the placement if chosen, else Heute.

## Left to the builder

Exact copy, the visual details of the path line within Graphit's tokens, and
the unit grouping per course (within the rules above).

## Addendum: a grammar topic for every unit

The first build left half the units without grammar and repeated topics, so
the path did not add up to a grammar course. Every unit now has its own
focus: Spanish gained 18 categories (Fragewörter, Uhrzeit und Datum,
Adjektive angleichen, gustar/doler, reflexive Verben, hay/estar, ir a +
Infinitiv, Possessiv, Vergleiche, Imperativ, Objektpronomen, muy/mucho,
Pretérito perfecto, Indefinido oder Imperfecto, estar + Gerundio,
Relativsätze, Satzverbinder, unpersönliches se), English 12 (do/does,
a/an/the, possessives, adjective or adverb, there is, can/could, much/many,
comparatives, must/have to, relative clauses, used to, passive), each with ten
closed items and an explanation. The perfecto is taught as a grammar topic
rather than a tense in the verb trainer. The grammar trainer groups topics by
the level where the path teaches them and pre-selects those up to the
learner's current level.
