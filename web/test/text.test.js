/* Answer checking: what counts as right, almost right and wrong. */
const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");

const { TEXT } = load("text.js");
const judge = (typed, ...alts) => TEXT.judge(typed, alts);

test("norm ignores case, accents, edge punctuation and spacing", () => {
  assert.equal(TEXT.norm("  ¿Qué  TAL? "), "que tal");
  assert.equal(TEXT.norm("Ça va!"), "ca va");
  assert.equal(TEXT.norm(null), "");
});

test("norm treats phone keyboard punctuation like the plain one", () => {
  assert.equal(TEXT.norm("I’m afraid"), TEXT.norm("I'm afraid"));
  assert.equal(TEXT.norm("„hola“"), "hola");
  assert.equal(TEXT.norm("could you…?"), TEXT.norm("could you...?"));
  assert.equal(TEXT.norm("could you…?"), "could you");
});

test("exact match among the alternatives", () => {
  assert.equal(judge("la casa", "la casa"), "exact");
  assert.equal(judge("musica", "música"), "exact");
  assert.equal(judge("hogar", "la casa", "el hogar", "hogar"), "exact");
  assert.equal(judge("", "la casa"), "wrong");
  assert.equal(judge("   ", "la casa"), "wrong");
});

test("one typo is almost right, scaled by word length", () => {
  assert.equal(judge("la csaa", "la casa"), "close");        // swapped letters
  assert.equal(judge("gracias pro tu ayuda", "gracias por tu ayuda"), "close");
  assert.equal(judge("restaurnt", "restaurant"), "close");    // one letter in a long word
  assert.equal(judge("restrnt", "restaurant"), "wrong");      // too far off
  assert.equal(judge("sol", "sal"), "wrong");                 // short words: no slack
});

test("a mixed-up word is wrong, not a typo", () => {
  assert.equal(judge("gracias para tu ayuda", "gracias por tu ayuda"), "wrong");
  assert.equal(judge("I have seen him yesterday", "I saw him yesterday"), "wrong");
  assert.equal(judge("la casa blanca", "la casa"), "wrong");  // extra word
});

test("a missing apostrophe stays a spelling mistake", () => {
  assert.equal(judge("im afraid", "I'm afraid"), "wrong");
  assert.equal(judge("dont worry", "don't worry"), "close");
});

test("meanings: a bracketed note does not have to be typed", () => {
  const typed = (answer, de) => TEXT.judge(answer, TEXT.meanings(de));
  assert.equal(typed("vor", "vor (zeitlich)"), "exact");
  assert.equal(typed("vor (zeitlich)", "vor (zeitlich)"), "exact");   // typing the note is fine too
  assert.equal(typed("kurz", "kurz (nicht: der Brief)"), "exact");
  assert.equal(typed("groß", "groß (Person)|hoch"), "exact");
  assert.equal(typed("hoch", "groß (Person)|hoch"), "exact");
  assert.equal(typed("übrig haben", "erübrigen|übrig haben (nicht: sparen)"), "exact");
  assert.equal(typed("die Pommes", "die Pommes (BE)"), "exact");
  assert.equal(typed("lang", "kurz (nicht: der Brief)"), "wrong");
  assert.equal(typed("Katze", "die Katze"), "wrong");                  // the article belongs to the answer
  assert.equal(TEXT.meanings("die Katze").length, 1);
});

test("esc escapes everything that could become markup", () => {
  assert.equal(TEXT.esc(`<img src=x onerror="a('b')">&`), "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
});

test("markdownLite renders the coach's report safely", () => {
  const md = TEXT.markdownLite;
  assert.equal(md("**Thema:** Alltag und *ser vs. estar*."), "<p><strong>Thema:</strong> Alltag und <em>ser vs. estar</em>.</p>");
  assert.equal(md("Erst\n\n- eins\n- **zwei**"), "<p>Erst</p><ul><li>eins</li><li><strong>zwei</strong></li></ul>");
  assert.equal(md("Zeile 1\nZeile 2"), "<p>Zeile 1<br>Zeile 2</p>");
  assert.equal(md('<img src=x onerror="alert(1)"> **<b>x</b>**'), "<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt; <strong>&lt;b&gt;x&lt;/b&gt;</strong></p>");
  assert.equal(md("3 * 4 = 12, a*b"), "<p>3 * 4 = 12, a*b</p>");          // no stray italics
  assert.equal(md(""), "");
});
