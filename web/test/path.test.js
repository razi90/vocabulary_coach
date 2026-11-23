/* The course path: current unit, new words, today's plan, checks, placement. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { load, course } = require("./load");

const { PATH } = load("text.js", "path.js");
const plain = (x) => JSON.parse(JSON.stringify(x));

// A tiny course: two A1 units, one A2 unit.
const deck = [
  { term: "uno", de: "eins", pos: "num", level: "A1", topic: "Zahlen" },
  { term: "dos", de: "zwei", pos: "num", level: "A1", topic: "Zahlen" },
  { term: "tres", de: "drei", pos: "num", level: "A1", topic: "Zahlen" },
  { term: "cuatro", de: "vier", pos: "num", level: "A1", topic: "Zahlen" },
  { term: "el pan", de: "das Brot", pos: "noun", level: "A1", topic: "Essen" },
  { term: "la leche", de: "die Milch", pos: "noun", level: "A1", topic: "Essen" },
  { term: "ir", de: "gehen", pos: "verb", level: "A2", topic: "Verben" },
  { term: "andar", de: "gehen|laufen", pos: "verb", level: "A2", topic: "Verben" },
];
const coursePath = {
  LEVELS: { A1: { title: "Grundlagen", goal: "…" }, A2: { title: "Alltag", goal: "…" } },
  UNITS: [
    { id: "nums", level: "A1", title: "Zählen", goal: "…", topics: ["Zahlen"] },
    { id: "food", level: "A1", title: "Essen", goal: "…", topics: ["Essen"], focus: { kind: "grammar", id: "articles" } },
    { id: "verbs", level: "A2", title: "Verben", goal: "…", topics: ["Verben"], focus: { kind: "tense", id: "presente" } },
  ],
  GUIDES: { "grammar:articles": { title: "Artikel", body: ["…"], examples: [] } },
};
const grammarItems = [1, 2, 3, 4, 5].map((n) => ({ id: `a${n}`, category: "articles", prompt: `___ ${n}`, options: ["el", "la"], answer: "el", explanation: "…" }));
const built = PATH.build(coursePath, deck);
const learned = (...terms) => Object.fromEntries(terms.map((t) => [t, { id: t, state: "review" }]));
const ctx = (over = {}) => ({ path: PATH.emptyState(), cards: {}, grammarCards: {}, conjCards: {}, grammarItems, ...over });
const seq = (...values) => { let i = 0; return () => values[i++ % values.length]; };

test("units resolve their words in deck order and know their place", () => {
  assert.deepEqual([...built.units[0].words], ["uno", "dos", "tres", "cuatro"]);
  assert.equal(built.units[1].posInLevel, 2);
  assert.equal(built.units[1].ofLevel, 2);
  assert.deepEqual(plain(built.levels.map((l) => l.id)), ["A1", "A2"]);
});

test("a unit built around a situation claims its words first; topic units skip them", () => {
  const b = PATH.build({ ...coursePath, UNITS: [
    { id: "nums", level: "A1", title: "", goal: "", topics: ["Zahlen"] },
    { id: "market", level: "A1", title: "", goal: "", topics: ["Essen"], vocab: ["la leche", "dos", "ir"] },
  ] }, deck);
  assert.deepEqual([...b.byId.get("nums").words], ["uno", "tres", "cuatro"]);
  assert.deepEqual([...b.byId.get("market").words], ["la leche", "dos", "ir", "el pan"]);
});

test("a part takes its slice of the unit's words", () => {
  const split = PATH.build({ ...coursePath, UNITS: [
    { id: "p1", level: "A1", title: "", goal: "", topics: ["Zahlen"], part: [1, 2] },
    { id: "p2", level: "A1", title: "", goal: "", topics: ["Zahlen"], part: [2, 2] },
  ] }, deck);
  assert.deepEqual([...split.units[0].words], ["uno", "dos"]);
  assert.deepEqual([...split.units[1].words], ["tres", "cuatro"]);
});

test("a fresh learner is in the first unit and is offered only its words", () => {
  assert.equal(PATH.current(built, ctx()).id, "nums");
  assert.deepEqual([...PATH.freshTerms(built, ctx())], ["uno", "dos", "tres", "cuatro"]);
});

test("words introduced count, the rest stay on offer", () => {
  const c = ctx({ cards: { ...learned("uno", "dos"), tres: { id: "tres", state: "new" } } });
  assert.deepEqual([...PATH.freshTerms(built, c)], ["tres", "cuatro"]);
  assert.deepEqual(plain(PATH.progress(built.units[0], c).words), { done: 2, total: 4, complete: false });
});

test("no new words from the next unit before the check is passed", () => {
  const c = ctx({ cards: learned("uno", "dos", "tres", "cuatro") });
  assert.equal(PATH.current(built, c).id, "nums");
  assert.deepEqual([...PATH.freshTerms(built, c)], []);
});

test("passing the check moves on to the next unit", () => {
  const path = PATH.completeUnit(PATH.emptyState(), "nums", 5);
  const c = ctx({ path, cards: learned("uno", "dos", "tres", "cuatro") });
  assert.equal(PATH.current(built, c).id, "food");
  assert.deepEqual([...PATH.freshTerms(built, c)], ["el pan", "la leche"]);
});

test("a unit the learner picks comes first until it is done", () => {
  const c = ctx({ path: { ...PATH.emptyState(), focus: "verbs" } });
  assert.equal(PATH.current(built, c).id, "verbs");
  const done = ctx({ path: PATH.completeUnit({ ...PATH.emptyState(), focus: "verbs" }, "verbs") });
  assert.equal(done.path.focus, null);
  assert.equal(PATH.current(built, done).id, "nums");
});

test("the plan is the unit's steps: words, grammar, then the check once all words are in", () => {
  const path = PATH.completeUnit(PATH.emptyState(), "nums");
  let p = PATH.plan(built, ctx({ path }), { due: 3, fresh: 2 });
  assert.equal(p.unit.id, "food");
  assert.deepEqual(plain(p.steps), [
    { kind: "vocab", unitId: "food", title: "Wörter", meta: "2 neu · 3 wiederholen", done: false, due: 3 },
    { kind: "focus", unitId: "food", title: "Artikel", meta: "Erklärung lesen, dann üben", done: false },
    { kind: "check", unitId: "food", title: "Abschluss-Check", meta: "Wenn alle Wörter gelernt sind · 0 von 2", done: false, later: true },
  ]);
  assert.equal(PATH.nextStep(p.steps).kind, "vocab");

  const seen = { ...path, guides: { "grammar:articles": 1 } };
  const practised = { a1: { attempts: 3 }, a2: { attempts: 2 } };
  p = PATH.plan(built, ctx({ path: seen, grammarCards: practised, cards: learned("el pan", "la leche") }), { due: 0, fresh: 0 });
  // Words in and grammar practised: both ticked, the check is next.
  assert.deepEqual(plain(p.steps), [
    { kind: "vocab", unitId: "food", title: "Wörter", meta: "Alle 2 Wörter gelernt", done: true, due: 0 },
    { kind: "focus", unitId: "food", title: "Artikel", meta: "Geübt", done: true },
    { kind: "check", unitId: "food", title: "Abschluss-Check", meta: "Ab 80 % ist die Einheit geschafft", done: false, later: false },
  ]);
  assert.equal(PATH.nextStep(p.steps).kind, "check");

  p = PATH.plan(built, ctx({ path: seen, grammarCards: { a1: { attempts: 3 } } }), { due: 0, fresh: 0 });
  assert.equal(p.steps[1].meta, "Üben · 3 von 5");
  assert.equal(PATH.nextStep(p.steps).kind, "focus");   // check waits, so grammar is next
});

test("grammar needs as many attempts as there are items, at most eight", () => {
  const p = PATH.progress(built.units[1], ctx({ grammarCards: { a1: { attempts: 4 } } }));
  assert.deepEqual(plain(p.focus), { key: "grammar:articles", seen: false, attempts: 4, need: 5, done: false });
});

test("a tense counts attempts on that tense only", () => {
  const conjCards = { "ser|presente|0": { attempts: 10 }, "ser|futuro|0": { attempts: 9 }, "ir|presente|2": { attempts: 2 } };
  const p = PATH.progress(built.units[2], ctx({ conjCards }));
  assert.equal(p.focus.attempts, 12);
  assert.equal(p.focus.done, true);
});

test("the check: known words first, half choice and half typed, plus the focus", () => {
  const c = ctx({ cards: learned("el pan") });
  const items = PATH.checkItems(built.units[1], c, { deck, grammarItems }, seq(0.1, 0.7, 0.3, 0.9, 0.5));
  const vocab = items.filter((i) => i.kind === "vocab");
  assert.equal(vocab.length, 2);
  assert.deepEqual(plain(vocab.map((i) => i.type).sort()), ["choice", "type"]);
  assert.equal(items.filter((i) => i.kind === "grammar").length, 4);
  const choice = vocab.find((i) => i.type === "choice");
  assert.ok(choice.options.includes(choice.answer));
  assert.equal(new Set(choice.options).size, choice.options.length);
});

test("typing a word accepts every word with the same German meaning", () => {
  const items = PATH.checkItems(built.units[2], ctx(), { deck, grammarItems }, seq(0.99, 0.01));
  const typed = items.find((i) => i.type === "type" && i.term === "ir") || items.find((i) => i.type === "type");
  assert.ok(typed.accepted.includes("ir") && typed.accepted.includes("andar"));
});

test("a tense focus adds typed verb forms", () => {
  const { CONJUGATE } = course("es");
  const items = PATH.checkItems(built.units[2], ctx(), { deck, grammarItems, conj: CONJUGATE }, Math.random);
  const forms = items.filter((i) => i.kind === "conj");
  assert.equal(forms.length, 4);
  forms.forEach((f) => {
    assert.equal(f.tense, "presente");
    assert.equal(f.answer, CONJUGATE.getForms(CONJUGATE.findVerb(f.infinitive)).presente[f.person]);
  });
});

test("80 percent passes a check", () => {
  assert.equal(PATH.passed(8, 10), true);
  assert.equal(PATH.passed(7, 10), false);
  assert.equal(PATH.passed(4, 5), true);
  assert.equal(PATH.passed(0, 0), false);
});

test("placement draws words of the level spread over its units, plus its grammar", () => {
  const items = PATH.placementItems(built, "A1", { deck, grammarItems }, Math.random);
  assert.equal(items.filter((i) => i.kind === "grammar").length, 2);
  const words = items.filter((i) => i.kind === "vocab").map((i) => i.term);
  assert.equal(words.length, 6);   // the tiny deck has only six A1 words
  assert.ok(words.includes("el pan") && words.includes("uno"));
  assert.equal(PATH.nextLevel(built, "A1"), "A2");
  assert.equal(PATH.nextLevel(built, "A2"), null);
});

test("placement skips the units of every passed level", () => {
  const path = PATH.applyPlacement(built, null, ["A1"], 7);
  assert.deepEqual(plain(path.units), {
    nums: { status: "skipped", at: 7, via: "placement" },
    food: { status: "skipped", at: 7, via: "placement" },
  });
  assert.equal(PATH.current(built, ctx({ path })).id, "verbs");
  assert.deepEqual(plain(PATH.levelSummary(built, ctx({ path }))), [{ id: "A1", finished: 2, total: 2 }, { id: "A2", finished: 0, total: 1 }]);
});

test("learners from before the path keep their place", () => {
  assert.deepEqual(plain(PATH.migrate(built, undefined, {})), plain(PATH.emptyState()));
  const path = PATH.migrate(built, undefined, learned("uno", "dos", "tres", "cuatro", "el pan"), 3);
  assert.deepEqual(plain(path.units), { nums: { status: "skipped", at: 3, via: "legacy" } });
  assert.equal(PATH.current(built, ctx({ path, cards: learned("uno", "dos", "tres", "cuatro", "el pan") })).id, "food");
  const kept = { ...PATH.emptyState(), focus: "verbs" };
  assert.equal(PATH.migrate(built, kept, {}).focus, "verbs");
});

test("after the last unit there is no current unit and only vocabulary in the plan", () => {
  const path = PATH.applyPlacement(built, null, ["A1", "A2"]);
  const p = PATH.plan(built, ctx({ path }), { due: 1, fresh: 0 });
  assert.equal(p.unit, null);
  assert.deepEqual(plain(p.steps.map((s) => s.kind)), ["vocab"]);
});

test("each grammar category belongs to the level where the path first teaches it", () => {
  assert.deepEqual(plain(PATH.categoryLevels(built)), { articles: "A1" });
  const { PATH: P, COURSE_PATH, DECK } = course("es");
  const levels = P.categoryLevels(P.build(COURSE_PATH, DECK));
  assert.equal(levels.ser_estar, "A1");
  assert.equal(levels.por_para, "A2");
  assert.equal(levels.se_impersonal, "B1");
});

test("a unit with a lesson: dialogue first, then words and grammar, sentences, speaking, check", () => {
  const withLesson = PATH.build({ ...coursePath, UNITS: [{ ...coursePath.UNITS[1], lesson: {
    dialogue: { title: "Im Café", scene: "", lines: [{ who: "A", t: "Un café.", de: "Einen Kaffee." }],
      questions: [{ prompt: "¿Qué pide?", options: ["Un café", "Un té"], answer: "Un café" }] },
    sentences: [{ de: "das Brot", t: "el pan" }, { de: "die Milch", t: "la leche", alt: ["leche"] }],
    task: { kind: "speak", title: "Bestellen", prompt: "…", phrases: [], model: "…" },
  } }] }, deck);
  const u = withLesson.units[0];
  let steps = PATH.steps(withLesson, u, ctx());
  assert.deepEqual(plain(steps.map((s) => s.kind)), ["dialog", "vocab", "focus", "sentences", "task", "check"]);
  assert.equal(PATH.nextStep(steps).kind, "dialog");
  // Reviews that are due come before the new dialogue.
  assert.equal(PATH.nextStep(PATH.steps(withLesson, u, ctx(), { due: 2, fresh: 5 })).kind, "vocab");
  assert.equal(PATH.nextStep(PATH.steps(withLesson, u, ctx(), { due: 0, fresh: 5 })).kind, "dialog");
  assert.equal(steps[0].meta, "Lesen, anhören, 1 Frage");

  let path = PATH.recordLesson(PATH.emptyState(), u.id, "dialog", { right: 1, total: 1 }, 5);
  path = PATH.recordLesson(path, u.id, "task", { text: "Un café, por favor." }, 6);
  steps = PATH.steps(withLesson, u, ctx({ path }));
  assert.equal(steps[0].done, true);
  assert.equal(steps[0].meta, "1 von 1 Fragen richtig");
  assert.equal(steps.find((s) => s.kind === "task").done, true);
  assert.deepEqual(plain(path.lessons[u.id].dialog), { right: 1, total: 1, at: 5 });

  const items = PATH.lessonItems(u, "sentences");
  assert.deepEqual(plain(items[1]), { kind: "sentence", type: "type", id: "food#2", prompt: "die Milch", answer: "la leche", accepted: ["la leche", "leche"] });
  assert.deepEqual(plain(PATH.lessonItems(u, "dialog")[0].options), ["Un café", "Un té"]);
});

test("other units show their own word progress instead of today's counts", () => {
  const steps = PATH.steps(built, built.units[0], ctx({ cards: learned("uno") }));
  assert.equal(steps[0].meta, "1 von 4 gelernt");
});
