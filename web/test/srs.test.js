/* Spaced repetition: the scheduling rules that decide when a card comes back. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");

const { SRS } = load("srs.js");
const NOW = Date.UTC(2026, 0, 1);
const MIN = 60000;
const review = (card, grade, now = NOW) => SRS.review(card, grade, { now, desiredRetention: 0.9 });

/** Graduates a new card with "good" twice (1 and 10 minute steps). */
function graduated() {
  let c = review(SRS.newCard("x"), 3);
  c = review(c, 3, c.due);
  return c;
}

test("a new card goes through the learning steps", () => {
  const c1 = review(SRS.newCard("x"), 3);
  assert.equal(c1.state, "learning");
  assert.equal(c1.due - NOW, 10 * MIN);        // "good" moves to the 10-minute step
  const again = review(SRS.newCard("x"), 1);
  assert.equal(again.due - NOW, 1 * MIN);
  const hard = review(SRS.newCard("x"), 2);
  assert.equal(hard.due - NOW, 5.5 * MIN);      // midpoint to the next step
  assert.equal(review(SRS.newCard("x"), 4).state, "review");   // "easy" graduates at once
});

test("graduated cards get day intervals that grow with success", () => {
  const c = graduated();
  assert.equal(c.state, "review");
  assert.ok(c.interval >= 1);
  const next = review(c, 3, c.due);
  assert.ok(next.interval > c.interval, `${next.interval} > ${c.interval}`);
  const easy = review(c, 4, c.due);
  const hard = review(c, 2, c.due);
  assert.ok(easy.interval >= next.interval && next.interval >= hard.interval);
});

test("a lapse sends the card to relearning and counts it", () => {
  const c = graduated();
  const lapsed = review(c, 1, c.due);
  assert.equal(lapsed.state, "relearning");
  assert.equal(lapsed.lapses, 1);
  assert.equal(lapsed.due - c.due, 10 * MIN);
  assert.ok(lapsed.stability < c.stability);
  assert.equal(review(lapsed, 3, lapsed.due).state, "review");
});

test("intervals stay within one day and two years", () => {
  assert.equal(SRS.intervalFor(0.01, 0.9), 1);
  assert.equal(SRS.intervalFor(1e6, 0.9), 730);
  let c = graduated();
  for (let i = 0; i < 30; i++) c = review(c, 4, c.due);
  assert.ok(c.interval <= 730);
  assert.ok(c.difficulty >= 1 && c.difficulty <= 10);
});

test("review does not mutate the card it is given", () => {
  const c = SRS.newCard("x");
  const before = JSON.stringify(c);
  review(c, 3);
  assert.equal(JSON.stringify(c), before);
});

test("leech after five lapses", () => {
  assert.equal(SRS.isLeech({ lapses: 4 }), false);
  assert.equal(SRS.isLeech({ lapses: 5 }), true);
});
