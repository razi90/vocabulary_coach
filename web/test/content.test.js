/* Course content: the rules every course has to keep, so a slip in a deck,
   a verb table or a grammar item is caught before a learner meets it. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { course, COURSES } = require("./load");

const ROOT = path.join(__dirname, "..", "..");
const LEVELS = new Set(["A1", "A2", "B1"]);
const POS = new Set(["noun", "verb", "adj", "adv", "num", "pron", "prep", "conj", "phrase"]);
const balanced = (s) => (s.match(/\(/g) || []).length === (s.match(/\)/g) || []).length;

for (const id of COURSES) {
  const { COURSE, DECK, CONJUGATE, GRAMMAR, TEXT, COURSE_PATH, PATH } = course(id);

  test(`${id}: course metadata`, () => {
    assert.equal(COURSE.id, id);
    for (const key of ["lang", "speechLang", "flag", "name", "nameDe", "inDe", "hintExample", "praise"]) {
      assert.ok(COURSE[key], `COURSE.${key}`);
    }
    for (const t of COURSE.defaultTenses) assert.ok(CONJUGATE.TENSES.includes(t), `default tense ${t}`);
  });

  test(`${id}: deck entries are complete and unique`, () => {
    const seen = new Set();
    for (const d of DECK) {
      const where = `${id} "${d.term}"`;
      assert.ok(d.term && d.term === d.term.trim(), `${where}: term`);
      assert.ok(!seen.has(d.term), `${where}: term is a card id and must be unique`);
      seen.add(d.term);
      assert.ok(d.de && !d.de.split("|").some((m) => !m.trim()), `${where}: de has an empty meaning`);
      assert.ok(LEVELS.has(d.level), `${where}: level ${d.level}`);
      assert.ok(POS.has(d.pos), `${where}: pos ${d.pos}`);
      assert.ok(d.topic, `${where}: topic`);
      assert.equal(!!d.ex, !!d.exDe, `${where}: ex and exDe come together`);
      assert.ok(balanced(d.de) && balanced(d.term), `${where}: unbalanced brackets`);
    }
  });

  test(`${id}: every deck card can be answered by typing`, () => {
    for (const d of DECK) {
      // Course language -> German: every meaning, with or without its note.
      for (const meaning of d.de.split("|")) {
        const bare = meaning.replace(/\s*\([^)]*\)/g, "");
        assert.equal(TEXT.judge(bare, TEXT.meanings(d.de)), "exact", `${id} "${d.term}": typing "${bare}"`);
      }
      // German -> course language: the term itself.
      assert.ok(TEXT.norm(d.term), `${id} "${d.term}": term is empty after normalizing`);
    }
  });

  test(`${id}: example sentences are not repeated`, () => {
    const seen = new Map();
    for (const d of DECK.filter((x) => x.ex)) {
      const key = TEXT.norm(d.ex);
      assert.ok(!seen.has(key), `${id}: "${d.ex}" used for "${seen.get(key)}" and "${d.term}"`);
      seen.set(key, d.term);
    }
  });

  test(`${id}: every verb has every form`, () => {
    assert.equal(CONJUGATE.PERSON_LABELS.length, 6);
    for (const t of CONJUGATE.TENSES) {
      assert.ok(CONJUGATE.TENSE_LABELS[t], `label for ${t}`);
      assert.ok(CONJUGATE.TENSE_EXPLANATIONS[t], `explanation for ${t}`);
    }
    for (const v of CONJUGATE.ALL_VERBS) {
      const forms = CONJUGATE.getForms(v);
      assert.ok(v.de, `${id} ${v.infinitive}: de`);
      for (const t of CONJUGATE.TENSES) {
        assert.equal(forms[t].length, 6, `${id} ${v.infinitive} ${t}`);
        forms[t].forEach((f, p) => assert.ok(f && f === f.trim() && !f.includes("undefined"),
          `${id} ${v.infinitive} ${t} person ${p}: "${f}"`));
      }
    }
  });

  test(`${id}: grammar items are unambiguous`, () => {
    const ids = new Set();
    for (const it of GRAMMAR.ITEMS) {
      const where = `${id} grammar ${it.id}`;
      assert.ok(!ids.has(it.id), `${where}: duplicate id`);
      ids.add(it.id);
      assert.ok(GRAMMAR.CATEGORY_LABELS[it.category], `${where}: unknown category ${it.category}`);
      assert.ok(it.prompt.includes("___"), `${where}: prompt needs a gap`);
      assert.ok(it.options.length >= 2, `${where}: at least two options`);
      assert.equal(new Set(it.options).size, it.options.length, `${where}: duplicate option`);
      assert.ok(it.options.includes(it.answer), `${where}: answer is not an option`);
      assert.ok(it.explanation, `${where}: explanation`);
    }
    for (const c of GRAMMAR.CATEGORIES) {
      assert.ok(GRAMMAR.CATEGORY_EXPLANATIONS[c], `${id} category ${c}: explanation`);
      assert.ok(GRAMMAR.itemsForCategory(c).length >= 4, `${id} category ${c}: too few items to drill`);
    }
  });

  test(`${id}: every deck word is in exactly one unit of the path`, () => {
    const built = PATH.build(COURSE_PATH, DECK);
    const owner = new Map();
    for (const u of built.units) {
      assert.ok(u.words.length >= 8, `${id} unit ${u.id}: only ${u.words.length} words`);
      for (const t of u.words) {
        assert.ok(!owner.has(t), `${id} "${t}" is in ${owner.get(t)} and ${u.id}`);
        owner.set(t, u.id);
      }
    }
    assert.deepEqual([...DECK.filter((d) => !owner.has(d.term)).map((d) => `${d.level} ${d.topic}: ${d.term}`)], []);
  });

  test(`${id}: units are complete and point at what the course has`, () => {
    const ids = new Set();
    let lastLevel = 0;
    for (const u of COURSE_PATH.UNITS) {
      const where = `${id} unit ${u.id}`;
      assert.ok(!ids.has(u.id), `${where}: duplicate id`);
      ids.add(u.id);
      assert.ok(COURSE_PATH.LEVELS[u.level], `${where}: level ${u.level} has no title`);
      const rank = PATH.LEVEL_ORDER.indexOf(u.level);
      assert.ok(rank >= lastLevel, `${where}: levels go in order`);
      lastLevel = rank;
      assert.ok(u.title && u.goal && u.topics.length, `${where}: title, goal, topics`);
      if (u.part) {
        // Slices only partition when every unit splitting a list names the same topics.
        const siblings = COURSE_PATH.UNITS.filter((x) => x.part && x.level === u.level && x.part[1] === u.part[1]
          && x.topics.some((t) => u.topics.includes(t)));
        siblings.forEach((x) => assert.deepEqual([...x.topics].sort(), [...u.topics].sort(), `${where}: ${x.id} splits other topics`));
      }
      if (u.vocab) {
        const terms = new Set(DECK.map((d) => d.term));
        u.vocab.forEach((t) => assert.ok(terms.has(t), `${where}: vocab "${t}" is not in the deck`));
        const elsewhere = COURSE_PATH.UNITS.filter((x) => x !== u && x.vocab && x.vocab.some((t) => u.vocab.includes(t)));
        assert.deepEqual([...elsewhere.map((x) => x.id)], [], `${where}: vocab claimed by another unit too`);
      }
      if (u.lesson) {
        const { dialogue: d, sentences, task } = u.lesson;
        assert.ok(d.title && d.scene && d.lines.length >= 4, `${where}: dialogue needs a title, a scene and lines`);
        d.lines.forEach((l, i) => assert.ok(l.who && l.t && l.de, `${where}: dialogue line ${i + 1}`));
        assert.ok(d.questions.length >= 2, `${where}: at least two questions on the dialogue`);
        d.questions.forEach((q) => {
          assert.ok(q.options.includes(q.answer), `${where}: "${q.prompt}" answer is not an option`);
          assert.equal(new Set(q.options).size, q.options.length, `${where}: "${q.prompt}" duplicate option`);
        });
        assert.ok(sentences.length >= 4, `${where}: at least four sentences`);
        sentences.forEach((x) => assert.ok(x.de && x.t && TEXT.judge(x.t, [x.t, ...(x.alt || [])]) === "exact", `${where}: sentence "${x.de}"`));
        assert.ok(["speak", "write"].includes(task.kind) && task.title && task.prompt && task.model && task.phrases.length,
          `${where}: task needs kind, title, prompt, phrases, model`);
      }
      if (!u.focus) continue;
      if (u.focus.kind === "grammar") assert.ok(GRAMMAR.CATEGORY_LABELS[u.focus.id], `${where}: unknown grammar ${u.focus.id}`);
      else if (u.focus.kind === "tense") assert.ok(CONJUGATE.TENSE_LABELS[u.focus.id], `${where}: unknown tense ${u.focus.id}`);
      else assert.fail(`${where}: focus kind ${u.focus.kind}`);
      const guide = COURSE_PATH.GUIDES[`${u.focus.kind}:${u.focus.id}`];
      assert.ok(guide, `${where}: no guide for ${u.focus.kind}:${u.focus.id}`);
    }
    for (const [key, g] of Object.entries(COURSE_PATH.GUIDES)) {
      assert.ok(g.title && g.body.length && g.examples.length >= 3, `${id} guide ${key}: title, body, three examples`);
      g.examples.forEach((e) => assert.ok(e.t && e.de, `${id} guide ${key}: example needs t and de`));
    }
  });

  test(`${id}: the coach's course prompt names exactly what the content has`, () => {
    const md = fs.readFileSync(path.join(ROOT, "backend/src/main/resources/coach", `course-${id}.md`), "utf8");
    const after = (label) => {
      const start = md.indexOf(label);
      assert.ok(start >= 0, `course-${id}.md: "${label}" missing`);
      return md.slice(start + label.length).split(/\n(?:\s*\n|- |\*\*)/)[0];
    };
    const ticks = (s) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]).sort();
    const list = (s) => s.split(",").map((x) => x.trim()).filter(Boolean).sort();
    assert.deepEqual(ticks(after("**Grammar categories:**")), [...GRAMMAR.CATEGORIES].sort());
    assert.deepEqual(ticks(after("- Tenses:")), [...CONJUGATE.TENSES].sort());
    assert.deepEqual(list(after("- Topics (German, as stored):")), [...new Set(DECK.map((d) => d.topic))].sort());
  });
}

test("en: verb forms follow English spelling", () => {
  const { CONJUGATE } = course("en");
  const f = (inf, tense, person) => CONJUGATE.getForms(CONJUGATE.findVerb(inf))[tense][person];
  assert.equal(f("go", "simple_present", 2), "goes");
  assert.equal(f("study", "simple_present", 2), "studies");
  assert.equal(f("play", "simple_present", 2), "plays");
  assert.equal(f("watch", "simple_present", 2), "watches");
  assert.equal(f("have", "simple_present", 2), "has");
  assert.equal(f("be", "simple_present", 0), "am");
  assert.equal(f("be", "simple_past", 1), "were");
  assert.equal(f("make", "present_progressive", 3), "are making");
  assert.equal(f("see", "present_progressive", 0), "am seeing");
  assert.equal(f("stop", "present_progressive", 2), "is stopping");
  assert.equal(f("study", "simple_past", 0), "studied");
  assert.equal(f("travel", "simple_past", 0), "travelled");
  assert.equal(f("go", "present_perfect", 2), "has gone");
  assert.equal(f("forget", "present_perfect", 0), "have forgotten");
  assert.equal(f("swim", "simple_past", 5), "swam");
  assert.equal(f("want", "will_future", 4), "will want");
  assert.deepEqual([...CONJUGATE.alternatives("has gone")], ["has gone", "'s gone"]);
  assert.deepEqual([...CONJUGATE.alternatives("went")], ["went"]);
});

test("content.json is what tools/export-content.js generates", () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "content-")), "content.json");
  execFileSync(process.execPath, [path.join(ROOT, "tools/export-content.js"), out], { stdio: "ignore" });
  const committed = path.join(ROOT, "backend/src/main/resources/content/content.json");
  assert.ok(fs.readFileSync(out, "utf8") === fs.readFileSync(committed, "utf8"),
    "content.json is stale: run node tools/export-content.js and commit the result");
});
