/* Generischer Übungsablauf.

   Alle Übungsarten teilen dieselbe Mechanik: eine Warteschlange abarbeiten,
   richtig/falsch zählen, Falsches später noch einmal einstreuen, Fortschritt
   anzeigen. Diese Datei kennt kein DOM und keine Aufgabenart – wer eine neue
   Übung baut, braucht nur noch eine Render-Funktion. */
const DRILL = (() => {
  function create(items, opts = {}) {
    return {
      items: [...items],
      idx: 0,
      reviewed: 0,
      correct: 0,
      barPct: 0,
      requeueWrong: opts.requeueWrong !== false,
      meta: opts.meta || {},
    };
  }

  const current = (d) => (d && d.items[d.idx]) || null;
  const isDone = (d) => !d || d.idx >= d.items.length;

  /** Antwort verbuchen. Falsches wandert ein paar Positionen weiter nach hinten. */
  function record(d, ok) {
    d.reviewed += 1;
    if (ok) d.correct += 1;
    const item = current(d);
    if (!ok && d.requeueWrong && item && !item.__requeued) {
      const at = Math.min(d.items.length, d.idx + 3 + Math.floor(Math.random() * 3));
      d.items.splice(at, 0, { ...item, __requeued: true });
    }
    return d;
  }

  const advance = (d) => { d.idx += 1; return d; };

  /** Breite, die nie schrumpft – Nachzügler verlängern die Warteschlange. */
  function progress(d) {
    const pct = d.items.length ? (d.idx / d.items.length) * 100 : 0;
    d.barPct = Math.max(d.barPct, pct);
    return `${d.barPct}%`;
  }

  const accuracy = (d) => (d.reviewed ? Math.round((d.correct / d.reviewed) * 100) : null);

  /**
   * Auswahl nach Übungsbedarf: Fehler zuerst, dann Ungeübtes, dann lange
   * nicht Wiederholtes. Der Zufallsanteil verhindert immer dieselbe Reihenfolge.
   */
  function score(rec, now = Date.now()) {
    if (!rec || !rec.attempts) return 4 + Math.random() * 2;
    const wrong = rec.wrongCount * 2 + (rec.lastResult === "wrong" ? 3 : 0);
    const stale = Math.min(3, (now - rec.lastAt) / (7 * 86400000));
    const mastered = rec.wrongCount === 0 ? -2 : 0;
    return wrong + stale + mastered + Math.random() * 2;
  }

  /** Die n dringendsten Einträge auswählen und für die Anzeige mischen. */
  function select(items, keyFn, recordsById, n) {
    const picked = items
      .map((it) => ({ it, s: score(recordsById[keyFn(it)]) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, n)
      .map((x) => x.it);
    for (let i = picked.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [picked[i], picked[j]] = [picked[j], picked[i]];
    }
    return picked;
  }

  return { create, current, isDone, record, advance, progress, accuracy, score, select };
})();
