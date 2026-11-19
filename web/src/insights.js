/* Read-only views over the learner's own data: one word's history, the
   practice calendar, the week in numbers, the hardest words.

   Pure functions over cards, events and the deck - nothing here touches the
   page or the server, so Node tests can load it (web/test/insights.test.js).
   Needs TEXT (text.js) for comparing typed answers. */
const INSIGHTS = (() => {
  const DAY = 86400000;

  /** Local day key, as app.js uses it for its logs. */
  function dayKey(t) {
    const d = new Date(t);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** Answers per local day, across all trainers. */
  function answersPerDay(events) {
    const out = new Map();
    events.forEach((e) => {
      if (typeof e.t !== "number") return;
      const k = dayKey(e.t);
      const d = out.get(k) || { answers: 0, correct: 0 };
      d.answers += 1;
      if (e.ok) d.correct += 1;
      out.set(k, d);
    });
    return out;
  }

  /** 0 (none) to 3 (a lot): the shade of a calendar day. */
  function level(answers) {
    if (!answers) return 0;
    if (answers < 15) return 1;
    if (answers < 40) return 2;
    return 3;
  }

  /**
   * One month as calendar weeks, Monday first. Each cell is null (outside
   * the month) or { day, key, answers, level, today, future }.
   * month: 0-11, as in Date.
   */
  function calendar(events, year, month, now = Date.now()) {
    const perDay = answersPerDay(events);
    const todayKey = dayKey(now);
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const lead = (first.getDay() + 6) % 7;            // Monday = 0
    const cells = Array(lead).fill(null);
    for (let day = 1; day <= daysInMonth; day++) {
      const key = dayKey(new Date(year, month, day).getTime());
      const answers = (perDay.get(key) || { answers: 0 }).answers;
      cells.push({ day, key, answers, level: level(answers), today: key === todayKey, future: key > todayKey });
    }
    while (cells.length % 7) cells.push(null);
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  }

  /** The current week (Monday to today): answers, percent right, days practised. */
  function weekSummary(events, now = Date.now()) {
    const today = new Date(now);
    const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
    const perDay = answersPerDay(events);
    let answers = 0, correct = 0, days = 0;
    for (let i = 0; i < 7; i++) {
      const key = dayKey(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i).getTime());
      const d = perDay.get(key);
      if (d) { answers += d.answers; correct += d.correct; days += 1; }
    }
    return { answers, accuracy: answers ? Math.round((correct / answers) * 100) : null, days };
  }

  /**
   * Which deck word a typed answer actually is, if it is another one: the
   * typical confusion ("la puerta" answered with "die Verspätung" = el retraso).
   */
  function confusedWith(typed, dir, deck, ownTerm) {
    const t = TEXT.norm(typed);
    if (!t) return null;
    const hit = deck.find((d) => d.term !== ownTerm && (dir === "es-de"
      ? TEXT.meanings(d.de).includes(t)
      : TEXT.norm(d.term) === t));
    return hit || null;
  }

  /**
   * One word's record: how often answered and right, the card state, and the
   * last three different typed answers that were wrong or only almost right.
   */
  function wordHistory(term, { events, card, deck }) {
    const own = events.filter((e) => e.kind === "vocab" && e.id === term);
    // The same slip three times says less than three different ones.
    const seen = new Set();
    const slips = own
      .filter((e) => e.typed && (!e.ok || e.grade === 2) && TEXT.norm(e.typed) !== TEXT.norm(e.expected))
      .reverse()
      .filter((e) => { const k = TEXT.norm(e.typed); if (seen.has(k)) return false; seen.add(k); return true; })
      .slice(0, 3)
      .map((e) => {
        const other = e.ok ? null : confusedWith(e.typed, e.dir, deck, term);
        return { typed: e.typed, almost: !!e.ok, t: e.t, confusedWith: other ? { term: other.term, de: other.de.split("|")[0] } : null };
      });
    return {
      attempts: own.length,
      correct: own.filter((e) => e.ok).length,
      state: !card || card.state === "new" ? "new" : card.state === "review" ? (card.stability >= 21 ? "mature" : "young") : "learning",
      due: card && card.state !== "new" ? card.due : null,
      slips,
    };
  }

  /**
   * The words that went wrong most in the last 30 days (with lapses as a
   * tie-breaker), at most n. Only words with at least one wrong answer.
   */
  function hardestWords({ events, cards, deck, now = Date.now(), n = 5 }) {
    const since = now - 30 * DAY;
    const wrong = new Map();
    events.forEach((e) => {
      if (e.kind === "vocab" && !e.ok && e.t >= since) wrong.set(e.id, (wrong.get(e.id) || 0) + 1);
    });
    const byTerm = new Map(deck.map((d) => [d.term, d]));
    return [...wrong]
      .filter(([term]) => byTerm.has(term))
      .map(([term, count]) => ({ term, de: byTerm.get(term).de.split("|")[0], wrong: count, lapses: (cards[term] || {}).lapses || 0 }))
      .sort((a, b) => b.wrong - a.wrong || b.lapses - a.lapses || a.term.localeCompare(b.term))
      .slice(0, n);
  }

  return { dayKey, answersPerDay, level, calendar, weekSummary, wordHistory, hardestWords, confusedWith };
})();

if (typeof module !== "undefined" && module.exports) module.exports = INSIGHTS;
