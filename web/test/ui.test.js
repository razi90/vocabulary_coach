/* The look: icons come from the SVG sprite, never from emoji (they render
   differently on every system). Course flags live in courses/<id>/course.js
   and are content, so they are not checked here. */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const WEB = path.join(__dirname, "..");
const files = ["index.html", "login.html", ...fs.readdirSync(path.join(WEB, "src")).filter((f) => f.endsWith(".js")).map((f) => `src/${f}`)];
// Flags (regional indicator pairs) are content and allowed; pictographs are not.
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}]\u{FE0F}?/gu;
const ALLOWED = new Set(["✓", "✗", "✕"]);   // plain text marks, and ✕ in code comments

test("no emoji used as icons in the shared UI", () => {
  const found = [];
  for (const f of files) {
    fs.readFileSync(path.join(WEB, f), "utf8").split("\n").forEach((line, i) => {
      for (const m of line.matchAll(EMOJI)) if (!ALLOWED.has(m[0])) found.push(`${f}:${i + 1} ${m[0]}`);
    });
  }
  assert.deepEqual(found, []);
});

test("every icon used has a symbol in the sprite", () => {
  const html = fs.readFileSync(path.join(WEB, "index.html"), "utf8");
  const defined = new Set([...html.matchAll(/<symbol id="i-([a-z-]+)"/g)].map((m) => m[1]));
  const used = new Set();
  for (const f of files) {
    const src = fs.readFileSync(path.join(WEB, f), "utf8");
    for (const m of src.matchAll(/#i-([a-z-]+)"/g)) used.add(m[1]);
    for (const m of src.matchAll(/icon\("([a-z-]+)"/g)) used.add(m[1]);
  }
  const iconsJs = fs.readFileSync(path.join(WEB, "src/app.js"), "utf8").match(/TODAY_ICONS = \{([^}]*)\}/);
  if (iconsJs) for (const m of iconsJs[1].matchAll(/"([a-z-]+)"/g)) used.add(m[1]);
  used.delete("name");   // the usage example in the sprite's comment
  assert.deepEqual([...used].filter((n) => !defined.has(n)), []);
});
