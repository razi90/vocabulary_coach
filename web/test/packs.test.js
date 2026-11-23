/* Exercise sets: validation and grading in the browser. The server validates
   the same rules in PackValidator.java (see PackValidatorTest) - keep the
   cases in step. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");

const { PACKS } = load("text.js", "courses/en/course.js", "packs.js");
const pack = (items, extra = {}) => ({ schema: PACKS.SCHEMA, id: "p", title: "T", items, ...extra });

test("accepts valid items of every type and fills in defaults", () => {
  const { pack: p, errors } = PACKS.parse(pack([
    { type: "choice", prompt: "I ___ him yesterday.", options: ["saw", "have seen"], answer: "saw" },
    { type: "cloze", prompt: "I have lived here ___ 2015.", answer: "since" },
    { type: "translate", prompt: "Ich habe keine Ahnung.", answer: "I have no idea", alternatives: ["I've no idea"] },
  ]));
  assert.equal(errors.length, 0);
  assert.equal(p.items.length, 3);
  assert.equal(p.items[2].from, "de");
  assert.equal(p.items[2].to, "en");          // the course language
  assert.equal(p.items[1].lang, "en");
});

test("drops broken items and names the reason", () => {
  const { pack: p, errors } = PACKS.parse(pack([
    { type: "choice", prompt: "x", options: ["a", "b"], answer: "c" },
    { type: "choice", prompt: "x", options: ["a"], answer: "a" },
    { type: "cloze", prompt: "no gap", answer: "a" },
    { type: "riddle", prompt: "x" },
    { type: "translate", prompt: "Haus", answer: "house" },
  ]));
  assert.equal(p.items.length, 1);
  assert.equal(errors.length, 4);
  assert.match(errors[0], /answer "c" ist keine der options/);
  assert.match(errors[1], /mindestens zwei options/);
  assert.match(errors[2], /Lücke/);
  assert.match(errors[3], /unbekannten type "riddle"/);
});

test("rejects a set without schema, id or valid items", () => {
  assert.equal(PACKS.parse(null).pack, null);
  assert.equal(PACKS.parse({ ...pack([{ type: "translate", prompt: "a", answer: "b" }]), schema: "x" }).pack, null);
  assert.equal(PACKS.parse(pack([{ type: "translate", prompt: "a", answer: "b" }], { id: " " })).pack, null);
  assert.equal(PACKS.parse(pack([])).pack, null);
  assert.equal(PACKS.parse(pack([{ type: "translate", prompt: "a" }])).pack, null);
});

test("caps a set at 100 items", () => {
  const items = Array.from({ length: 120 }, (_, i) => ({ type: "translate", prompt: `p${i}`, answer: "a" }));
  const { pack: p, errors } = PACKS.parse(pack(items));
  assert.equal(p.items.length, 100);
  assert.match(errors[0], /ersten 100/);
});

test("grading: choice exact only, typed answers with typo tolerance", () => {
  const { pack: p } = PACKS.parse(pack([
    { type: "choice", prompt: "x", options: ["since", "for"], answer: "since" },
    { type: "cloze", prompt: "Thank you ___ your help.", answer: "for" },
    { type: "translate", prompt: "Danke für deine Hilfe.", answer: "thanks for your help", alternatives: ["thank you for your help"] },
  ]));
  const [choice, cloze, translate] = p.items;
  assert.equal(PACKS.checkAnswer(choice, "since"), "exact");
  assert.equal(PACKS.checkAnswer(choice, "Since"), "wrong");
  assert.equal(PACKS.checkAnswer(cloze, "For"), "exact");
  assert.equal(PACKS.checkAnswer(translate, "Thank you for your help!"), "exact");
  assert.equal(PACKS.checkAnswer(translate, "thanks for your hlep"), "close");
  assert.equal(PACKS.checkAnswer(translate, "thanks to your help"), "wrong");
  assert.deepEqual([...PACKS.acceptedAnswers(translate)], ["thanks for your help", "thank you for your help"]);
});
