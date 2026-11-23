/* Word history, practice calendar, week summary and hardest words. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");

const { INSIGHTS } = load("text.js", "insights.js");
const plain = (x) => JSON.parse(JSON.stringify(x));
const at = (y, m, d, h = 12) => new Date(y, m, d, h).getTime();

const deck = [
  { term: "la puerta", de: "die Tür" },
  { term: "el retraso", de: "die Verspätung" },
  { term: "la casa", de: "das Haus" },
];

test("calendar: Monday-first weeks, answers per day, today and future marked", () => {
  // November 2026 starts on a Sunday.
  const events = [
    ...Array.from({ length: 3 }, () => ({ t: at(2026, 10, 2), ok: true })),
    ...Array.from({ length: 20 }, () => ({ t: at(2026, 10, 3), ok: false })),
    ...Array.from({ length: 50 }, () => ({ t: at(2026, 10, 4), ok: true })),
    { t: at(2026, 9, 31), ok: true },                       // October: not in this month
  ];
  const weeks = plain(INSIGHTS.calendar(events, 2026, 10, at(2026, 10, 19)));
  assert.equal(weeks[0].slice(0, 6).every((c) => c === null), true);
  assert.equal(weeks[0][6].day, 1);
  const flat = weeks.flat().filter(Boolean);
  assert.equal(flat.length, 30);
  const day = (n) => flat.find((c) => c.day === n);
  assert.deepEqual([day(1).answers, day(2).answers, day(3).answers, day(4).answers], [0, 3, 20, 50]);
  assert.deepEqual([day(1).level, day(2).level, day(3).level, day(4).level], [0, 1, 2, 3]);
  assert.equal(day(19).today, true);
  assert.equal(day(20).future, true);
  assert.equal(day(18).future, false);
  assert.equal(weeks.every((w) => w.length === 7), true);
});

test("week summary counts Monday to today", () => {
  const now = at(2026, 10, 19);                              // a Thursday
  const events = [
    { t: at(2026, 10, 16), ok: true }, { t: at(2026, 10, 16), ok: false },   // Monday
    { t: at(2026, 10, 19, 8), ok: true },                    // today
    { t: at(2026, 10, 15), ok: true },                       // last Sunday: previous week
  ];
  assert.deepEqual(plain(INSIGHTS.weekSummary(events, now)), { answers: 3, accuracy: 67, days: 2 });
  assert.deepEqual(plain(INSIGHTS.weekSummary([], now)), { answers: 0, accuracy: null, days: 0 });
});

test("word history: record, state and the last slips with confusions", () => {
  const events = [
    { kind: "vocab", id: "la puerta", dir: "es-de", ok: true, grade: 3, typed: null, expected: "die Tür", t: 1 },
    { kind: "vocab", id: "la puerta", dir: "es-de", ok: false, grade: 1, typed: "die Verspätung", expected: "die Tür", t: 2 },
    { kind: "vocab", id: "la puerta", dir: "de-es", ok: true, grade: 2, typed: "la puerto", expected: "la puerta", t: 3 },
    { kind: "vocab", id: "la puerta", dir: "de-es", ok: false, grade: 1, typed: "la casa", expected: "la puerta", t: 4 },
    { kind: "vocab", id: "la casa", dir: "es-de", ok: false, typed: "x", expected: "das Haus", t: 5 },
  ];
  const h = plain(INSIGHTS.wordHistory("la puerta", { events, card: { state: "review", stability: 30, due: 99 }, deck }));
  assert.equal(h.attempts, 4);
  assert.equal(h.correct, 2);
  assert.equal(h.state, "mature");
  assert.equal(h.due, 99);
  assert.deepEqual(h.slips.map((s) => s.typed), ["la casa", "la puerto", "die Verspätung"]);
  assert.deepEqual(h.slips[0].confusedWith, { term: "la casa", de: "das Haus" });
  assert.equal(h.slips[1].almost, true);
  assert.equal(h.slips[1].confusedWith, null);
  assert.deepEqual(h.slips[2].confusedWith, { term: "el retraso", de: "die Verspätung" });
});

test("word history lists each slip once, newest first", () => {
  const ev = (typed, t) => ({ kind: "vocab", id: "la puerta", dir: "es-de", ok: false, typed, expected: "die Tür", t });
  const events = [ev("die Verspätung", 1), ev("das Haus", 2), ev("die Verspätung", 3), ev("die verspätung", 4), ev("die Tor", 5)];
  const h = plain(INSIGHTS.wordHistory("la puerta", { events, card: undefined, deck }));
  assert.deepEqual(h.slips.map((s) => s.typed), ["die Tor", "die verspätung", "das Haus"]);
});

test("word history of an unseen word", () => {
  assert.deepEqual(plain(INSIGHTS.wordHistory("la casa", { events: [], card: undefined, deck })),
    { attempts: 0, correct: 0, state: "new", due: null, slips: [] });
});

test("hardest words: wrong answers in the last 30 days, lapses break ties", () => {
  const now = at(2026, 10, 19);
  const wrong = (id, daysAgo) => ({ kind: "vocab", id, ok: false, t: now - daysAgo * 86400000 });
  const events = [
    wrong("la casa", 1), wrong("la casa", 2),
    wrong("la puerta", 1), wrong("el retraso", 3),
    wrong("la puerta", 40),                                  // too old
    wrong("gone", 1),                                        // no longer in the deck
    { kind: "vocab", id: "la casa", ok: true, t: now },
  ];
  const cards = { "el retraso": { lapses: 3 }, "la puerta": { lapses: 1 } };
  const top = plain(INSIGHTS.hardestWords({ events, cards, deck, now }));
  assert.deepEqual(top.map((w) => w.term), ["la casa", "el retraso", "la puerta"]);
  assert.deepEqual(top[0], { term: "la casa", de: "das Haus", wrong: 2, lapses: 0 });
  assert.equal(INSIGHTS.hardestWords({ events, cards, deck, now, n: 1 }).length, 1);
});
