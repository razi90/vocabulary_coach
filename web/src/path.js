/* The course path: which unit the learner is in, what each unit's steps have
   reached, what today's plan is, and the items of a unit check or a
   placement round.

   Pure functions over the course content (COURSE_PATH, DECK, GRAMMAR,
   CONJUGATE) and the learner's state, so Node tests can load them
   (web/test/path.test.js). The app passes everything in; nothing here reads
   a global except TEXT for normalizing answers.

   The learner's part lives in state.path:
     units   { [unitId]: { status: "done" | "skipped", at, via? } }
     focus   the unit the learner picked to learn next, or null
     guides  { [guideKey]: timestamp } explanations read
     checks  { [unitId]: { best, last, at } } scores in percent
     lessons { [unitId]: { dialog: { right, total, at }, sentences: { right,
             total, at }, task: { text, at } } } for units with a lesson */
const PATH = (() => {
  const LEVEL_ORDER = ["A1", "A2", "B1"];
  const CHECK_PASS = 0.8;          // share right to pass a unit check
  const PLACEMENT_PASS = 7;        // of PLACEMENT_SIZE to pass a level
  const PLACEMENT_SIZE = 10;
  const FOCUS_ATTEMPTS = { grammar: 8, tense: 12 };

  const emptyState = () => ({ units: {}, focus: null, guides: {}, checks: {}, lessons: {} });
  const guideKey = (focus) => (focus ? `${focus.kind}:${focus.id}` : null);
  const introduced = (card) => !!card && card.state !== "new";
  const primary = (de) => String(de).split("|")[0];

  /** The units with their words resolved (terms, in deck order) and their place in the course. */
  function build(coursePath, deck) {
    // A unit built around a situation claims the words its lesson uses
    // (`vocab`, in the order the lesson uses them). Topic units take what is
    // left of their topics, so every word still belongs to exactly one unit.
    const claimed = new Set(coursePath.UNITS.flatMap((u) => u.vocab || []));
    const byTerm = new Map(deck.map((d) => [d.term, d]));
    const units = coursePath.UNITS.map((u, index) => {
      let words = deck.filter((d) => d.level === u.level && u.topics.includes(d.topic) && !claimed.has(d.term));
      if (u.part) {
        const [k, n] = u.part;
        const size = Math.ceil(words.length / n);
        words = words.slice((k - 1) * size, k * size);
      }
      if (u.vocab) words = u.vocab.map((t) => byTerm.get(t)).filter(Boolean).concat(words);
      return { ...u, index, words: words.map((d) => d.term) };
    });
    const levels = LEVEL_ORDER.filter((l) => units.some((u) => u.level === l)).map((id) => {
      const own = units.filter((u) => u.level === id);
      return { id, ...(coursePath.LEVELS[id] || {}), units: own };
    });
    units.forEach((u) => {
      const own = levels.find((l) => l.id === u.level).units;
      u.posInLevel = own.indexOf(u) + 1;
      u.ofLevel = own.length;
    });
    return { units, levels, byId: new Map(units.map((u) => [u.id, u])), guides: coursePath.GUIDES || {} };
  }

  /** Attempts so far on a unit's grammar topic or tense, across all trainers. */
  function focusAttempts(focus, { grammarCards = {}, conjCards = {}, grammarItems = [] }) {
    if (!focus) return 0;
    if (focus.kind === "grammar") {
      return grammarItems.filter((it) => it.category === focus.id)
        .reduce((n, it) => n + ((grammarCards[it.id] && grammarCards[it.id].attempts) || 0), 0);
    }
    return Object.entries(conjCards).filter(([key]) => key.split("|")[1] === focus.id)
      .reduce((n, [, rec]) => n + (rec.attempts || 0), 0);
  }

  /**
   * Where a unit stands. ctx: { path (state.path), cards, grammarCards,
   * conjCards, grammarItems }.
   */
  function progress(unit, ctx) {
    const path = ctx.path || emptyState();
    const rec = path.units[unit.id] || {};
    const wordsDone = unit.words.filter((t) => introduced(ctx.cards[t])).length;
    let focus = null;
    if (unit.focus) {
      const need = unit.focus.kind === "grammar"
        ? Math.min(FOCUS_ATTEMPTS.grammar, ctx.grammarItems.filter((it) => it.category === unit.focus.id).length)
        : FOCUS_ATTEMPTS.tense;
      const attempts = focusAttempts(unit.focus, ctx);
      focus = { key: guideKey(unit.focus), seen: !!path.guides[guideKey(unit.focus)], attempts, need, done: attempts >= need };
    }
    const check = path.checks[unit.id] || null;
    let lesson = null;
    if (unit.lesson) {
      const rec = (path.lessons || {})[unit.id] || {};
      lesson = { dialog: rec.dialog || null, sentences: rec.sentences || null, task: rec.task || null };
    }
    return {
      lesson,
      status: rec.status || "open",
      via: rec.via || null,
      words: { done: wordsDone, total: unit.words.length, complete: wordsDone >= unit.words.length },
      focus,
      check: { passed: rec.status === "done", best: check ? check.best : null },
      finished: rec.status === "done" || rec.status === "skipped",
    };
  }

  /** The unit the learner is in: their own pick while it is not done, else the first not finished. */
  function current(built, ctx) {
    const path = ctx.path || emptyState();
    const picked = path.focus && built.byId.get(path.focus);
    if (picked && (path.units[picked.id] || {}).status !== "done") return picked;
    return built.units.find((u) => !progress(u, ctx).finished) || null;
  }

  /** The current unit's words not introduced yet, in deck order: the only new words on offer. */
  function freshTerms(built, ctx) {
    const unit = current(built, ctx);
    return unit ? unit.words.filter((t) => !introduced(ctx.cards[t])) : [];
  }

  /**
   * A unit's steps, in teaching order. With a lesson: the dialogue first
   * (meet the language in use), then words and grammar, then building
   * sentences and saying something of your own, then the check. Without a
   * lesson: words, grammar, check.
   *
   * counts: { due, fresh } for the unit the learner is in, as the app
   * computes them (fresh after the daily limit); omitted for other units,
   * whose words step then shows the unit's own progress. Each step carries
   * `done`; the check is `later` until all words are in.
   */
  function steps(built, unit, ctx, counts) {
    const p = progress(unit, ctx);
    const out = [];
    const L = unit.lesson;
    const id = unit.id;
    if (L) {
      const d = p.lesson.dialog;
      out.push({ kind: "dialog", unitId: id, title: `Dialog: ${L.dialogue.title}`,
        meta: d ? `${d.right} von ${d.total} Fragen richtig` : `Lesen, anhören, ${L.dialogue.questions.length} ${L.dialogue.questions.length === 1 ? "Frage" : "Fragen"}`, done: !!d });
    }
    let wordsMeta = p.words.complete ? `Alle ${p.words.total} Wörter gelernt` : `${p.words.done} von ${p.words.total} gelernt`;
    let wordsDone = p.words.complete;
    if (counts) {
      const today = [counts.fresh && `${counts.fresh} neu`, counts.due && `${counts.due} wiederholen`].filter(Boolean).join(" · ");
      wordsMeta = today || (p.words.complete ? wordsMeta : "Für heute erledigt");
      wordsDone = counts.due + counts.fresh === 0;
    }
    out.push({ kind: "vocab", unitId: id, title: "Wörter", meta: wordsMeta, done: wordsDone, due: counts ? counts.due : 0 });
    if (unit.focus) {
      const guide = built.guides[p.focus.key];
      out.push({
        kind: "focus", unitId: id, title: guide ? guide.title : unit.focus.id,
        meta: p.focus.done ? "Geübt" : p.focus.seen ? `Üben · ${p.focus.attempts} von ${p.focus.need}` : "Erklärung lesen, dann üben",
        done: p.focus.done,
      });
    }
    if (L) {
      const s = p.lesson.sentences;
      out.push({ kind: "sentences", unitId: id, title: "Sätze bauen",
        meta: s ? `${s.right} von ${s.total} richtig` : `${L.sentences.length} Sätze aus dem Deutschen übersetzen`, done: !!s });
      out.push({ kind: "task", unitId: id, title: `${L.task.kind === "speak" ? "Sprechen" : "Schreiben"}: ${L.task.title}`,
        meta: p.lesson.task ? "Erledigt" : "In eigenen Worten", done: !!p.lesson.task });
    }
    out.push({
      kind: "check", unitId: id, title: "Abschluss-Check",
      meta: p.check.passed ? "Bestanden" : p.words.complete ? "Ab 80 % ist die Einheit geschafft"
        : `Wenn alle Wörter gelernt sind · ${p.words.done} von ${p.words.total}`,
      done: p.check.passed, later: !p.words.complete && !p.check.passed,
    });
    return out;
  }

  /**
   * Today's plan is the current unit's steps (see steps), with the
   * vocabulary step counting today's reviews and new words. Past the last
   * unit, only the vocabulary.
   */
  function plan(built, ctx, { due = 0, fresh = 0 } = {}) {
    const unit = current(built, ctx);
    if (!unit) {
      const today = [fresh && `${fresh} neu`, due && `${due} wiederholen`].filter(Boolean).join(" · ");
      return { unit: null, steps: [{ kind: "vocab", title: "Wörter", meta: today || "Für heute erledigt", done: due + fresh === 0, due }] };
    }
    return { unit, steps: steps(built, unit, ctx, { due, fresh }) };
  }

  /** Lesson items: the dialogue's questions, or the sentences to build (typed, course language). */
  function lessonItems(unit, part) {
    const L = unit.lesson;
    if (!L) return [];
    if (part === "dialog") {
      return L.dialogue.questions.map((q) => ({ kind: "dialog", type: "choice", prompt: q.prompt, options: [...q.options], answer: q.answer }));
    }
    return L.sentences.map((s, i) => ({ kind: "sentence", type: "type", id: `${unit.id}#${i + 1}`,
      prompt: s.de, answer: s.t, accepted: [s.t, ...(s.alt || [])] }));
  }

  /** Records a finished lesson part ("dialog", "sentences": { right, total }; "task": { text }). */
  function recordLesson(path, unitId, part, data, now = Date.now()) {
    const lessons = { ...((path && path.lessons) || {}) };
    lessons[unitId] = { ...(lessons[unitId] || {}), [part]: { ...data, at: now } };
    return { ...emptyState(), ...path, lessons };
  }

  /**
   * The step to do next. Reviews that are due come first, before anything
   * new (they keep yesterday's words alive); otherwise the first step that is
   * neither done nor waiting.
   */
  const nextStep = (steps) => steps.find((s) => s.kind === "vocab" && s.due > 0 && !s.done)
    || steps.find((s) => !s.done && !s.later) || null;

  // ---------- Items for checks and placement ----------

  function shuffled(arr, rand) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /** Multiple choice: course word → German, three wrong meanings from the same pool, all distinct. */
  function vocabChoice(d, pool, rand) {
    const answer = primary(d.de);
    const seen = new Set([TEXT.norm(answer)]);
    const wrong = [];
    for (const x of shuffled(pool.filter((x) => x.pos === d.pos), rand).concat(shuffled(pool, rand))) {
      const m = primary(x.de);
      if (seen.has(TEXT.norm(m))) continue;
      seen.add(TEXT.norm(m));
      wrong.push(m);
      if (wrong.length === 3) break;
    }
    return { kind: "vocab", type: "choice", term: d.term, dir: "es-de", prompt: d.term, answer,
      options: shuffled([answer, ...wrong], rand) };
  }

  /** Typing: German → course word; every word sharing the German meaning counts. */
  function vocabTyped(d, deck) {
    const key = TEXT.norm(primary(d.de));
    const accepted = deck.filter((x) => TEXT.norm(primary(x.de)) === key).map((x) => x.term);
    return { kind: "vocab", type: "type", term: d.term, dir: "de-es", prompt: primary(d.de), answer: d.term, accepted };
  }

  const grammarItem = (it) => ({ kind: "grammar", type: "choice", id: it.id, category: it.category,
    prompt: it.prompt, options: [...it.options], answer: it.answer, explanation: it.explanation });

  function conjItem(verb, tense, person, conj) {
    const form = conj.getForms(verb)[tense][person];
    const accepted = conj.alternatives ? conj.alternatives(form) : [form];
    return { kind: "conj", type: "type", infinitive: verb.infinitive, tense, person,
      prompt: `${conj.PERSON_LABELS[person]} ___ (${verb.infinitive})`, meta: conj.TENSE_LABELS[tense],
      answer: form, accepted };
  }

  /**
   * A unit check: up to 8 of its words (introduced ones first; half as
   * multiple choice, half typed) and up to 4 items on its focus.
   * content: { deck, grammarItems, conj }.
   */
  function checkItems(unit, ctx, content, rand = Math.random) {
    const byTerm = new Map(content.deck.map((d) => [d.term, d]));
    const words = unit.words.map((t) => byTerm.get(t)).filter(Boolean);
    const known = shuffled(words.filter((d) => introduced(ctx.cards[d.term])), rand);
    const rest = shuffled(words.filter((d) => !introduced(ctx.cards[d.term])), rand);
    const picked = known.concat(rest).slice(0, 8);
    const pool = content.deck.filter((d) => d.level === unit.level);
    const items = picked.map((d, i) => (i % 2 === 0 ? vocabChoice(d, pool, rand) : vocabTyped(d, content.deck)));

    if (unit.focus && unit.focus.kind === "grammar") {
      const own = content.grammarItems.filter((it) => it.category === unit.focus.id);
      shuffled(own, rand).slice(0, 4).forEach((it) => items.push(grammarItem(it)));
    } else if (unit.focus && unit.focus.kind === "tense" && content.conj) {
      shuffled(content.conj.ALL_VERBS, rand).slice(0, 4)
        .forEach((v) => items.push(conjItem(v, unit.focus.id, Math.floor(rand() * 6), content.conj)));
    }
    return shuffled(items, rand);
  }

  const passed = (correct, total) => total > 0 && correct / total >= CHECK_PASS - 1e-9;

  /** One placement round for a level: words as multiple choice, plus two items on the level's grammar. */
  function placementItems(built, level, content, rand = Math.random) {
    const units = built.units.filter((u) => u.level === level);
    const categories = [...new Set(units.filter((u) => u.focus && u.focus.kind === "grammar").map((u) => u.focus.id))];
    const grammar = shuffled(content.grammarItems.filter((it) => categories.includes(it.category)), rand).slice(0, 2);
    const pool = content.deck.filter((d) => d.level === level);
    // Spread the words over the level's units rather than drawing them all from one topic.
    const byUnit = units.map((u) => shuffled(u.words, rand));
    const terms = [];
    for (let i = 0; terms.length < PLACEMENT_SIZE - grammar.length && byUnit.some((w) => w.length); i++) {
      const w = byUnit[i % byUnit.length];
      if (w.length) terms.push(w.pop());
    }
    const byTerm = new Map(content.deck.map((d) => [d.term, d]));
    const items = terms.map((t) => vocabChoice(byTerm.get(t), pool, rand)).concat(grammar.map(grammarItem));
    return shuffled(items, rand);
  }

  /** The level after `level`, or null after the last. */
  function nextLevel(built, level) {
    const i = built.levels.findIndex((l) => l.id === level);
    return i >= 0 && i + 1 < built.levels.length ? built.levels[i + 1].id : null;
  }

  /** Placement outcome: every unit of a passed level is skipped; the learner starts after them. */
  function applyPlacement(built, path, passedLevels, now = Date.now()) {
    const next = { ...emptyState(), ...(path || {}), units: { ...((path && path.units) || {}) } };
    built.units.filter((u) => passedLevels.includes(u.level)).forEach((u) => {
      if ((next.units[u.id] || {}).status !== "done") next.units[u.id] = { status: "skipped", at: now, via: "placement" };
    });
    next.focus = null;
    next.placed = { levels: [...passedLevels], at: now };
    return next;
  }

  /**
   * The path state for a learner who has none yet. Someone who already
   * learned words before the path existed keeps their place: units whose
   * words are all introduced count as skipped.
   */
  function migrate(built, path, cards, now = Date.now()) {
    if (path) return { ...emptyState(), ...path };
    const next = emptyState();
    if (!Object.values(cards).some(introduced)) return next;
    built.units.forEach((u) => {
      if (u.words.length && u.words.every((t) => introduced(cards[t]))) next.units[u.id] = { status: "skipped", at: now, via: "legacy" };
    });
    return next;
  }

  /** A unit passed its check: done, and no longer the learner's explicit pick. */
  function completeUnit(path, unitId, now = Date.now()) {
    const next = { ...emptyState(), ...path, units: { ...path.units, [unitId]: { status: "done", at: now } } };
    if (next.focus === unitId) next.focus = null;
    return next;
  }

  /** The level where each grammar category first comes up on the path. */
  function categoryLevels(built) {
    const out = {};
    built.units.forEach((u) => {
      if (u.focus && u.focus.kind === "grammar" && !out[u.focus.id]) out[u.focus.id] = u.level;
    });
    return out;
  }

  /** Per level: units finished, of how many. */
  function levelSummary(built, ctx) {
    return built.levels.map((l) => ({
      id: l.id,
      finished: l.units.filter((u) => progress(u, ctx).finished).length,
      total: l.units.length,
    }));
  }

  return {
    LEVEL_ORDER, CHECK_PASS, PLACEMENT_PASS, PLACEMENT_SIZE,
    emptyState, guideKey, build, progress, current, freshTerms, steps, plan, nextStep, lessonItems, recordLesson,
    checkItems, passed, placementItems, nextLevel, applyPlacement, migrate, completeUnit, levelSummary, categoryLevels,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = PATH;
