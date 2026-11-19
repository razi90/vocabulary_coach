/* Loads browser scripts into a sandbox, the way the page does: plain
   <script> files that share one global scope. Tests get what the page gets. */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "..", "src");

/** Runs the given files (relative to web/src) and returns the sandbox. */
function load(...files) {
  const context = vm.createContext({ console, module: undefined });
  for (const file of files) {
    const full = path.join(SRC, file);
    vm.runInContext(fs.readFileSync(full, "utf8"), context, { filename: full });
  }
  // Top-level const declarations are not properties of the context; read them out.
  return new Proxy({}, { get: (_, name) => vm.runInContext(String(name), context) });
}

/** The full content of one course, as the page loads it. */
const course = (id) => load("text.js", ...["course", "deck", "conjugate", "grammar"]
  .map((f) => `courses/${id}/${f}.js`));

const COURSES = fs.readdirSync(path.join(SRC, "courses"));

module.exports = { load, course, COURSES, SRC };
