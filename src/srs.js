/* Spaced-repetition engine, modelled on FSRS.
   Every card has a stability S (days until recall drops to 90%) and a
   difficulty D (1-10). The interval is computed from the target retention,
   not from fixed multipliers as in classic SM-2. */

const SRS = (() => {
  const W = {
    // Initial stability per grade (days)
    initS: { 1: 0.4, 2: 1.2, 3: 3.1, 4: 8.2 },
    initD: { 1: 7.6, 2: 6.3, 3: 5.0, 4: 3.6 },
    dDecay: 0.9,      // inertia of the difficulty
    sInc: 3.2,        // base gain on success
    hardPenalty: 0.75,
    easyBonus: 1.35,
    lapseFactor: 1.9,
    maxInterval: 365 * 2,
  };

  const DAY = 86400000;
  const LEARN_STEPS = [1, 10];        // minutes
  const RELEARN_STEPS = [10];
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

  /** Waiting time of a learning step, in minutes.
      "Hard" stays on the step and takes the midpoint to the next step (on the
      last step: 1.5x) - the way Anki does it. */
  function stepDelay(steps, idx, grade) {
    const cur = steps[idx];
    if (grade !== 2) return cur;
    const next = steps[idx + 1];
    return next ? (cur + next) / 2 : cur * 1.5;
  }

  /** Probability of recall after t days at stability s */
  function retrievability(s, t) {
    if (s <= 0) return 0;
    return Math.pow(1 + t / (9 * s), -1);
  }

  function nextDifficulty(d, grade) {
    const target = d - 1.1 * (grade - 3);
    return clamp(W.dDecay * target + (1 - W.dDecay) * W.initD[3], 1, 10);
  }

  function nextStability(s, d, r, grade) {
    if (grade === 1) {
      // Lapse: stability collapses, but not to zero
      return clamp(W.lapseFactor * Math.pow(d, -0.4) * Math.pow(s, 0.25) *
        Math.exp(0.9 * (1 - r)), 0.2, s);
    }
    const bonus = grade === 2 ? W.hardPenalty : grade === 4 ? W.easyBonus : 1;
    const gain = 1 + Math.exp(W.sInc) * (11 - d) * Math.pow(s, -0.32) *
      (Math.exp(0.9 * (1 - r)) - 1) * bonus * 0.09;
    return clamp(s * gain, 0.2, W.maxInterval);
  }

  /** Interval in days for the desired retention (e.g. 0.9) */
  function intervalFor(s, desiredRetention) {
    const days = 9 * s * (1 / desiredRetention - 1);
    return clamp(Math.round(days), 1, W.maxInterval);
  }

  function newCard(id) {
    return {
      id, state: "new", stability: 0, difficulty: W.initD[3],
      due: 0, lastReview: 0, reps: 0, lapses: 0, step: 0,
    };
  }

  /**
   * Advance a card after a grade.
   * grade: 1 again | 2 hard | 3 good | 4 easy
   */
  function review(card, grade, opts = {}) {
    const now = opts.now ?? Date.now();
    const retention = opts.desiredRetention ?? 0.9;
    const c = { ...card };
    c.reps += 1;

    if (c.state === "new" || c.state === "learning" || c.state === "relearning") {
      const steps = c.state === "relearning" ? RELEARN_STEPS : LEARN_STEPS;
      if (c.state === "new") {
        c.stability = W.initS[grade];
        c.difficulty = W.initD[grade];
        c.state = "learning";
        c.step = 0;
      } else {
        // Next step: the grade pulls stability/difficulty along
        c.stability = Math.max(0.2, (c.stability + W.initS[grade]) / 2);
        c.difficulty = nextDifficulty(c.difficulty, grade);
      }

      if (grade === 1) {
        c.step = 0;
      } else if (grade === 4) {
        c.step = steps.length;           // graduate immediately
      } else if (grade === 2) {
        // "hard" stays on the current step
      } else {
        c.step += 1;                     // only "good" moves on
      }

      if (c.step >= steps.length) {
        c.state = "review";
        c.step = 0;
        const iv = intervalFor(c.stability, retention);
        c.due = now + iv * DAY;
        c.interval = iv;
      } else {
        c.due = now + stepDelay(steps, c.step, grade) * 60000;
        c.interval = 0;
      }
      c.lastReview = now;
      return c;
    }

    // Review of a mature card
    const elapsedDays = Math.max(0, (now - c.lastReview) / DAY);
    const r = retrievability(c.stability, elapsedDays);
    c.difficulty = nextDifficulty(c.difficulty, grade);
    c.stability = nextStability(c.stability, c.difficulty, r, grade);

    if (grade === 1) {
      c.lapses += 1;
      c.state = "relearning";
      c.step = 0;
      c.due = now + RELEARN_STEPS[0] * 60000;
      c.interval = 0;
    } else {
      const iv = intervalFor(c.stability, retention);
      c.due = now + iv * DAY;
      c.interval = iv;
    }
    c.lastReview = now;
    return c;
  }

  /** Preview: which grade would yield which interval? (for button labels) */
  function previewIntervals(card, opts = {}) {
    const out = {};
    for (const g of [1, 2, 3, 4]) {
      const next = review(card, g, opts);
      out[g] = next.state === "review"
        ? formatDays(next.interval)
        : `${Math.round((next.due - (opts.now ?? Date.now())) / 60000)} Min`;
    }
    return out;
  }

  function formatDays(d) {
    if (d < 1) return "<1 Tag";
    if (d < 30) return `${d} Tage`;
    if (d < 365) return `${(d / 30).toFixed(1)} Mon.`;
    return `${(d / 365).toFixed(1)} Jahre`;
  }

  /** How well does the card sit right now? 0..1 - drives the drill type */
  function strength(card, now = Date.now()) {
    if (card.state === "new") return 0;
    if (card.state !== "review") return 0.2;
    return clamp(card.stability / 60, 0.1, 1);
  }

  const isLeech = (card) => card.lapses >= 5;

  return { newCard, review, previewIntervals, retrievability, intervalFor,
           strength, isLeech, formatDays, DAY };
})();
