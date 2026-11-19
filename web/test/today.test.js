/* What Heute lists besides the vocabulary session, and the next step after a session. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");

const { TODAY } = load("today.js");
const plain = (x) => JSON.parse(JSON.stringify(x));
const grammarItems = [
  { id: "g1", category: "ser_estar" }, { id: "g2", category: "ser_estar" }, { id: "g3", category: "por_para" },
];
const grammarLabels = { ser_estar: "ser oder estar", por_para: "por oder para" };

test("nothing to list for a fresh learner", () => {
  assert.deepEqual(plain(TODAY.items({})), []);
});

test("today's lesson with its parts and how many are done", () => {
  const lesson = { id: 1, title: "Im Restaurant", listening: {}, writing: {}, sentences: {}, submissions: { writing: {} } };
  const [row] = plain(TODAY.items({ lesson }));
  assert.deepEqual(row, { kind: "lesson", title: "Im Restaurant", meta: "Hören · Schreiben · Sätze · 1 von 3 erledigt", done: false });
  const allDone = { ...lesson, submissions: { listening: {}, writing: {}, sentences: {} } };
  assert.equal(TODAY.items({ lesson: allDone })[0].done, true);
});

test("only exercise sets not practised yet, newest first", () => {
  const packs = [
    { id: "old", title: "Alt", items: [1], addedAt: 1 },
    { id: "new", title: "Neu", items: [1, 2], addedAt: 3 },
    { id: "done", title: "Geübt", items: [1], addedAt: 2 },
  ];
  const events = [{ kind: "pack", packId: "done" }, { kind: "vocab", id: "x" }];
  const rows = plain(TODAY.items({ packs, events }));
  assert.deepEqual(rows.map((r) => r.id), ["new", "old"]);
  assert.equal(rows[0].meta, "Neu vom Coach · 2 Aufgaben");
  assert.equal(rows[1].meta, "Neu vom Coach · 1 Aufgabe");
});

test("grammar topics only when their last answer was wrong, most mistakes first", () => {
  const grammarCards = { g1: { lastResult: "wrong" }, g2: { lastResult: "wrong" }, g3: { lastResult: "correct" } };
  let rows = plain(TODAY.items({ grammarCards, grammarItems, grammarLabels }));
  assert.deepEqual(rows, [{ kind: "grammar", id: "ser_estar", title: "ser oder estar", meta: "Grammatik · 2 zuletzt falsch" }]);
  grammarCards.g3.lastResult = "wrong";
  grammarCards.g2.lastResult = "correct";
  rows = plain(TODAY.items({ grammarCards, grammarItems, grammarLabels }));
  assert.deepEqual(rows.map((r) => r.id), ["ser_estar", "por_para"]);
});

test("order: lesson, then new sets, then grammar", () => {
  const rows = TODAY.items({
    lesson: { id: 1, writing: {} },
    packs: [{ id: "p", title: "P", items: [1] }],
    grammarCards: { g3: { lastResult: "wrong" } }, grammarItems, grammarLabels,
  });
  assert.deepEqual([...rows].map((r) => r.kind), ["lesson", "pack", "grammar"]);
});

test("next step skips what was just finished and what is done", () => {
  const list = [
    { kind: "lesson", done: true },
    { kind: "pack", id: "a" },
    { kind: "pack", id: "b" },
  ];
  assert.equal(TODAY.nextStep(list, { kind: "vocab" }).id, "a");
  assert.equal(TODAY.nextStep(list, { kind: "pack", id: "a" }).id, "b");
  assert.equal(TODAY.nextStep([{ kind: "pack", id: "a" }], { kind: "pack", id: "a" }), null);
  assert.equal(TODAY.nextStep([], { kind: "vocab" }), null);
});
