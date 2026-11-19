/* What is on today, apart from the vocabulary session itself.

   Pure functions over data the app already holds, so Node tests can load
   them (web/test/today.test.js). The app turns the result into rows on
   Heute and into the "next step" at the end of a session. */
const TODAY = (() => {
  const PART_LABELS = { listening: "Hören", writing: "Schreiben", sentences: "Sätze", speaking: "Sprechen" };

  /**
   * The rows for "Außerdem heute", in this order: today's lesson, coach
   * exercise sets not practised yet (newest first), grammar topics with items
   * whose last answer was wrong. Grammar has no due dates; a recent mistake is
   * the reason to come back.
   *
   * @param {object} input
   *   lesson        today's lesson from the API, or null
   *   packs         exercise sets ({ id, title, items, addedAt })
   *   events        the answer log
   *   grammarCards  state.grammarCards ({ [itemId]: { lastResult } })
   *   grammarItems  GRAMMAR.ITEMS
   *   grammarLabels GRAMMAR.CATEGORY_LABELS
   */
  function items({ lesson, packs = [], events = [], grammarCards = {}, grammarItems = [], grammarLabels = {} }) {
    const out = [];

    if (lesson && lesson.id) {
      const parts = Object.keys(PART_LABELS).filter((k) => lesson[k]);
      const done = parts.filter((k) => lesson.submissions && lesson.submissions[k]);
      out.push({
        kind: "lesson",
        title: lesson.title || "Tageslektion",
        meta: parts.map((k) => PART_LABELS[k]).join(" · ") + (done.length ? ` · ${done.length} von ${parts.length} erledigt` : ""),
        done: parts.length > 0 && done.length === parts.length,
      });
    }

    const practised = new Set(events.filter((e) => e.kind === "pack").map((e) => e.packId));
    packs.filter((p) => !practised.has(p.id))
      .slice().sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
      .forEach((p) => out.push({
        kind: "pack", id: p.id, title: p.title,
        meta: `Neu vom Coach · ${p.items.length} ${p.items.length === 1 ? "Aufgabe" : "Aufgaben"}`,
      }));

    const wrongByCategory = new Map();
    grammarItems.forEach((it) => {
      const rec = grammarCards[it.id];
      if (rec && rec.lastResult === "wrong") wrongByCategory.set(it.category, (wrongByCategory.get(it.category) || 0) + 1);
    });
    [...wrongByCategory].sort((a, b) => b[1] - a[1]).forEach(([category, n]) => out.push({
      kind: "grammar", id: category, title: grammarLabels[category] || category,
      meta: `Grammatik · ${n} zuletzt falsch`,
    }));

    return out;
  }

  /** The first open item, as the suggestion after a session; null if nothing is left. */
  function nextStep(list, finished) {
    return list.find((it) => !it.done && !(finished && it.kind === finished.kind && it.id === finished.id)) || null;
  }

  return { items, nextStep, PART_LABELS };
})();

if (typeof module !== "undefined" && module.exports) module.exports = TODAY;
