/* Exports the learning content from web/src/*.js to JSON for the backend.

   deck.js, conjugate.js and grammar.js are the source of truth: the browser
   loads them directly. The Spring Boot backend cannot run them, so this
   script evaluates them in a sandbox and writes the data it needs.

   Usage: node tools/export-content.js [output-file]
   The Docker build runs it, so the image is always in sync. After editing the
   content, run it once locally too (`npm run export-content`). */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "..", "web", "src");
const OUT = process.argv[2] ||
  path.join(__dirname, "..", "backend", "src", "main", "resources", "content", "content.json");

const context = vm.createContext({ console, module: undefined });
for (const file of ["text.js", "deck.js", "conjugate.js", "grammar.js"]) {
  vm.runInContext(fs.readFileSync(path.join(SRC, file), "utf8"), context, { filename: file });
}
const DECK = vm.runInContext("DECK", context);
const CONJUGATE = vm.runInContext("CONJUGATE", context);
const GRAMMAR = vm.runInContext("GRAMMAR", context);

// Irregular verbs carry no group - it is implied by the ending (oír -> ir).
const verbGroup = (v) => v.group ||
  v.infinitive.slice(-2).normalize("NFD").replace(/[̀-ͯ]/g, "");

const labels = [];
CONJUGATE.TENSES.forEach((t) => labels.push({ kind: "tense", key: t, label: CONJUGATE.TENSE_LABELS[t] }));
CONJUGATE.PERSON_LABELS.forEach((l, i) => labels.push({ kind: "person", key: String(i), label: l }));
Object.entries(GRAMMAR.CATEGORY_LABELS).forEach(([k, l]) => labels.push({ kind: "grammar_category", key: k, label: l }));

const content = {
  vocabulary: DECK.map((d) => ({
    es: d.es, de: d.de, dePrimary: d.de.split("|")[0], pos: d.pos, level: d.level,
    topic: d.topic, exampleEs: d.ex || null, exampleDe: d.exDe || null,
  })),
  verbs: CONJUGATE.ALL_VERBS.map((v) => ({
    infinitive: v.infinitive, de: v.de, irregular: !!v.irregular, group: verbGroup(v),
  })),
  grammarItems: GRAMMAR.ITEMS.map((g) => ({
    id: g.id, category: g.category, prompt: g.prompt, options: g.options,
    answer: g.answer, explanation: g.explanation,
  })),
  labels,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(content, null, 1) + "\n");
console.log(`${OUT}: ${content.vocabulary.length} Vokabeln, ${content.verbs.length} Verben, ` +
            `${content.grammarItems.length} Grammatikaufgaben`);
