/* Exports the learning content of every course to JSON for the backend.

   web/src/courses/<course>/deck.js, conjugate.js and grammar.js are the
   source of truth: the browser loads them directly. The Spring Boot backend
   cannot run them, so this script evaluates them in a sandbox and writes the
   data it needs.

   Usage: node tools/export-content.js [output-file]
   The Docker build runs it, so the image is always in sync. After editing the
   content, run it locally too and commit the regenerated content.json. */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "..", "web", "src");
const COURSES = ["es", "en"];
const OUT = process.argv[2] ||
  path.join(__dirname, "..", "backend", "src", "main", "resources", "content", "content.json");

// Irregular verbs may carry no group - for Spanish it follows from the ending (oír -> ir).
const verbGroup = (course, v) => v.group || (v.irregular ? "irregular"
  : v.infinitive.slice(-2).normalize("NFD").replace(/[\u0300-\u036f]/g, ""));

function exportCourse(course) {
  const context = vm.createContext({ console, module: undefined });
  const files = [path.join(SRC, "text.js"), ...["course", "deck", "conjugate", "grammar"]
    .map((f) => path.join(SRC, "courses", course, `${f}.js`))];
  for (const file of files) vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  const DECK = vm.runInContext("DECK", context);
  const CONJUGATE = vm.runInContext("CONJUGATE", context);
  const GRAMMAR = vm.runInContext("GRAMMAR", context);

  const labels = [];
  CONJUGATE.TENSES.forEach((t) => labels.push({ kind: "tense", key: t, label: CONJUGATE.TENSE_LABELS[t] }));
  CONJUGATE.PERSON_LABELS.forEach((l, i) => labels.push({ kind: "person", key: String(i), label: l }));
  Object.entries(GRAMMAR.CATEGORY_LABELS).forEach(([k, l]) => labels.push({ kind: "grammar_category", key: k, label: l }));

  return {
    vocabulary: DECK.map((d) => ({
      term: d.term, de: d.de, dePrimary: d.de.split("|")[0], pos: d.pos, level: d.level,
      topic: d.topic, exampleTerm: d.ex || null, exampleDe: d.exDe || null,
    })),
    verbs: CONJUGATE.ALL_VERBS.map((v) => ({
      infinitive: v.infinitive, de: v.de, irregular: !!v.irregular, group: verbGroup(course, v),
    })),
    grammarItems: GRAMMAR.ITEMS.map((g) => ({
      id: g.id, category: g.category, prompt: g.prompt, options: g.options,
      answer: g.answer, explanation: g.explanation,
    })),
    labels,
  };
}

const content = Object.fromEntries(COURSES.map((c) => [c, exportCourse(c)]));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(content, null, 1) + "\n");
for (const [course, c] of Object.entries(content)) {
  console.log(`${course}: ${c.vocabulary.length} Vokabeln, ${c.verbs.length} Verben, ` +
              `${c.grammarItems.length} Grammatikaufgaben`);
}
