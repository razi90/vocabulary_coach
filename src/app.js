/* Vocabulary trainer - app logic */
(function () {
  "use strict";

  const STORAGE_KEY = "voco.es.v1";
  const DAY = SRS.DAY;
  // Local date, not UTC: toISOString() would put the day boundary at
  // 01:00/02:00 local time in Central Europe and shift streak and daily goal.
  const todayKey = (t = Date.now()) => {
    const d = new Date(t);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  /** Days between two day keys, independent of daylight saving time. */
  function daysBetween(fromKey, toKey) {
    const [ay, am, ad] = fromKey.split("-").map(Number);
    const [by, bm, bd] = toKey.split("-").map(Number);
    return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY);
  }

  const esc = TEXT.esc;
  const norm = TEXT.norm;

  // ---------- State ----------
  /* The truth lives behind store.js. Only the working copies are here:
     `state` for settings and aggregates, `cards` for the learning state per
     word. The history lives exclusively in the event log. */
  let state = null;
  let cards = {};
  let events = [];
  let packs = [];

  let saveTimer = null;
  const dirtyCards = new Set();

  async function persist() {
    await STORE.saveState(state);
    const pending = [...dirtyCards];
    dirtyCards.clear();
    await Promise.all(pending.map((id) => cards[id] && STORE.saveCard(cards[id])));
  }
  function save(cardId) {
    if (cardId) dirtyCards.add(cardId);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; persist(); }, 150);
  }
  function flushSave() {
    if (saveTimer === null) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    persist();
  }
  window.addEventListener("pagehide", flushSave);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSave();
  });

  /** Every answer is logged as an event - that is the history. */
  async function logEvent(event) {
    const stored = { t: Date.now(), ...event };
    events.push(stored);
    try {
      const seq = await STORE.appendEvent(stored);
      stored.seq = seq;
    } catch (e) { /* Protokoll darf die Übung nie blockieren */ }
  }

  function ensureCard(id) {
    if (!cards[id]) cards[id] = SRS.newCard(id);
    return cards[id];
  }

  function cardsDueNow(now = Date.now()) {
    return DECK.filter((d) => {
      const c = cards[d.es];
      return c && c.state !== "new" && c.due <= now;
    });
  }
  function allFreshCards() {
    return DECK.filter((d) => !cards[d.es] || cards[d.es].state === "new");
  }
  // The daily limit for new cards equals the daily goal, but a click lifts it.
  function cardsNewAvailable() {
    const fresh = allFreshCards();
    if (state.newCapOverrideDay === todayKey()) return fresh;
    const introducedToday = state.newIntroducedOn[todayKey()] || 0;
    const remainingCap = Math.max(0, state.dailyGoal - introducedToday);
    return fresh.slice(0, remainingCap);
  }
  function learnedCount() {
    return Object.values(cards).filter((c) => c.state !== "new").length;
  }
  function matureCount() {
    return Object.values(cards).filter((c) => c.state === "review" && c.stability >= 21).length;
  }

  // ---------- Streak ----------
  function touchStreak() {
    const today = todayKey();
    if (state.lastActiveDay === today) return;
    if (state.lastActiveDay) {
      const gapDays = daysBetween(state.lastActiveDay, today);
      state.streak = gapDays === 1 ? state.streak + 1 : 1;
    } else {
      state.streak = 1;
    }
    state.lastActiveDay = today;
    save();
  }

  function logReview(correct) {
    const k = todayKey();
    if (!state.log[k]) state.log[k] = { reviewed: 0, correct: 0 };
    state.log[k].reviewed += 1;
    if (correct) state.log[k].correct += 1;
  }

  // ---------- Navigation ----------
  const views = {};
  document.querySelectorAll(".view").forEach((v) => (views[v.id.replace("view-", "")] = v));
  const tabs = document.querySelectorAll(".tab");

  let currentView = "home";

  /* On narrow screens the section list sits over the content as a drawer.
     On wide ones it is fixed on the left - "open" is meaningless there,
     because the stylesheet never turns the drawer on in the first place. */
  const sidenav = document.getElementById("sidenav");
  const navScrim = document.getElementById("navScrim");
  const menuBtn = document.getElementById("menuBtn");

  function setNavOpen(open) {
    sidenav.classList.toggle("open", open);
    navScrim.hidden = !open;
    menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }
  menuBtn.addEventListener("click", () => setNavOpen(!sidenav.classList.contains("open")));
  navScrim.addEventListener("click", () => setNavOpen(false));

  function showView(name) {
    currentView = name;
    Object.entries(views).forEach(([k, el]) => el.classList.toggle("active", k === name));
    tabs.forEach((t) => {
      const on = t.dataset.view === name;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    setNavOpen(false);
    const chosen = [...tabs].find((t) => t.dataset.view === name);
    // Text nodes only: the icon sits in a span of its own.
    if (chosen) el("topbarSection").textContent = [...chosen.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join("").trim();

    if (name === "browse") renderBrowse();
    if (name === "stats") { renderStats(); renderSyncStatus(); }
    if (name === "home") renderHome();
    if (name === "conj") renderConjOverview();
    if (name === "grammar") renderGrammarOverview();
    if (name === "packs") { el("tab-packs").classList.remove("tab-alert"); renderPacks(); }
    if (name === "lesson") { el("tab-lesson").classList.remove("tab-alert"); LESSON.render(); }
    // Nobody wants the video to keep playing while they drill vocabulary.
    if (name !== "lesson") { LESSON.stoppen(); const f = el("listeningFrame"); if (f && f.src) f.src = f.src; }
  }
  /* After a reload the tab should carry on where you were.
     sessionStorage rather than localStorage: a freshly opened tab starts on
     "Start" as usual, only reloading the same tab restores. */
  const POSITION_KEY = "voco:position";
  /* Running drills live in memory only and do not survive a reload. Instead
     of jumping into an empty session, fall back to the overview. */
  const VIEW_FALLBACK = {
    session: "home", conjsession: "conj", grammarsession: "grammar",
    packsession: "packs", done: "home",
  };

  function merkePosition() {
    try {
      sessionStorage.setItem(POSITION_KEY, JSON.stringify({
        view: VIEW_FALLBACK[currentView] || currentView,
        scrollY: Math.round(window.scrollY),
      }));
    } catch (e) { /* privater Modus: dann eben ohne */ }
  }

  function stellePositionHer() {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(POSITION_KEY) || "null"); }
    catch (e) { return; }
    if (!saved || !views[saved.view]) return;
    if (saved.view !== currentView) showView(saved.view);
    // Scroll only after painting, otherwise the page is still too short.
    requestAnimationFrame(() => window.scrollTo(0, saved.scrollY || 0));
  }

  // Our own restoration should not duplicate the browser's.
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  // pagehide as well, because Safari/iOS does not fire beforeunload reliably.
  window.addEventListener("beforeunload", merkePosition);
  window.addEventListener("pagehide", merkePosition);

  /** Is a drill running that the switch would throw away? */
  function activeDrill() {
    if (session && session.reviewed >= 0 && currentView === "session") return () => { session = null; };
    if (conjSession && currentView === "conjsession") return () => { conjSession = null; };
    if (grammarSession && currentView === "grammarsession") return () => { grammarSession = null; };
    if (packSession && currentView === "packsession") return () => { packSession = null; };
    return null;
  }
  tabs.forEach((t) => t.addEventListener("click", () => {
    const abandon = activeDrill();
    if (abandon) {
      if (!confirm("Die laufende Übung wird beendet. Fortfahren?")) return;
      abandon();
    }
    showView(t.dataset.view);
  }));

  // ---------- Home ----------
  const el = (id) => document.getElementById(id);

  function renderHome() {
    const due = cardsDueNow().length;
    const fresh = cardsNewAvailable().length;
    const learned = learnedCount();
    el("dueCount").textContent = due;
    el("newCount").textContent = fresh;
    el("learnedCount").textContent = learned;
    el("totalCount").textContent = DECK.length;
    el("streakCount").textContent = state.streak;

    document.querySelectorAll(".dir-btn").forEach((b) => b.classList.toggle("active", b.dataset.dir === state.direction));

    const goal = state.dailyGoal;
    const doneToday = (state.log[todayKey()] || { reviewed: 0 }).reviewed;
    const pct = Math.min(1, doneToday / goal);
    const circumference = 2 * Math.PI * 52;
    el("dailyRing").style.strokeDashoffset = String(circumference * (1 - pct));
    el("dailyDoneNum").textContent = doneToday;
    el("dailyGoalNum").textContent = goal;
    el("dailyGoal").value = goal;
    el("dailyGoalDisplay").textContent = goal;

    const startBtn = el("startSessionBtn");
    const moreWordsWaiting = allFreshCards().length > fresh;
    const keepLearningBtn = el("keepLearningBtn");
    if (due + fresh === 0) {
      startBtn.disabled = true;
      startBtn.textContent = "Alles erledigt für heute ✓";
      el("sessionHint").textContent = moreWordsWaiting
        ? "Tageslimit für neue Wörter erreicht."
        : "Komm morgen für neue Wiederholungen wieder.";
      keepLearningBtn.hidden = !moreWordsWaiting;
    } else {
      startBtn.disabled = false;
      startBtn.textContent = "Sitzung starten";
      el("sessionHint").textContent = `${due} fällig, ${fresh} neu · Karteikarten · Multiple Choice · Tippen`;
      keepLearningBtn.hidden = true;
    }
  }
  el("keepLearningBtn").addEventListener("click", () => {
    state.newCapOverrideDay = todayKey();
    save();
    renderHome();
  });

  el("dailyGoal").addEventListener("input", (e) => {
    state.dailyGoal = Number(e.target.value);
    el("dailyGoalDisplay").textContent = state.dailyGoal;
    el("dailyGoalNum").textContent = state.dailyGoal;
    save();
  });

  document.querySelectorAll(".dir-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.direction = btn.dataset.dir;
      save();
      renderHome();
    });
  });

  // ---------- Session ----------
  const MODES = ["flip", "mc", "type"];
  let session = null; // { queue: [deckItem...], idx, reviewed, correct, mode per item }

  function buildSessionQueue() {
    const due = cardsDueNow();
    const fresh = cardsNewAvailable();
    // Due first, then new ones mixed in; order shuffled for variety
    const items = shuffle([...due]).concat(shuffle([...fresh]));
    return items.slice(0, 60).map((d) => ({ deck: d, mode: pickMode(d) }));
  }

  function pickMode(deckItem) {
    const c = cards[deckItem.es];
    if (!c || c.state === "new") return "flip";           // new material always as a flashcard first
    const strength = SRS.strength(c);
    if (strength < 0.35) return Math.random() < 0.5 ? "flip" : "mc";
    if (strength < 0.7) return Math.random() < 0.5 ? "mc" : "type";
    return "type";                                          // well consolidated -> active recall
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function startSession() {
    const queue = buildSessionQueue();
    if (!queue.length) return;
    session = { queue, idx: 0, reviewed: 0, correct: 0 };
    touchStreak();
    showView("session");
    renderCurrentCard();
  }
  el("startSessionBtn").addEventListener("click", startSession);
  el("exitSessionBtn").addEventListener("click", () => { session = null; el("sessionContinueBtn").hidden = true; showView("home"); });

  let doneReturnView = "home";
  el("doneContinueBtn").addEventListener("click", () => showView(doneReturnView));

  /** A bar width that never shrinks - stragglers lengthen the queue. */
  function progressWidth(sess) {
    const pct = sess.queue.length ? (sess.idx / sess.queue.length) * 100 : 0;
    sess.barPct = Math.max(sess.barPct || 0, pct);
    return `${sess.barPct}%`;
  }

  function currentItem() { return (session && session.queue[session.idx]) || null; }

  function renderCurrentCard() {
    if (!session || session.idx >= session.queue.length) return finishSession();
    const item = currentItem();
    const d = item.deck;
    el("sessionIdx").textContent = session.idx + 1;
    el("sessionTotal").textContent = session.queue.length;
    el("sessionProgressBar").style.width = progressWidth(session);

    ["flip", "mc", "type"].forEach((m) => el(`mode-${m}`).hidden = m !== item.mode);
    el("sessionContinueBtn").hidden = true;

    if (item.mode === "flip") renderFlip(d);
    else if (item.mode === "mc") renderMC(d);
    else renderType(d);
  }

  // --- Flashcard ---
  const flashcardEl = el("flashcard");
  const flashcardInner = el("flashcardInner");
  let flipped = false;

  function renderFlip(d) {
    // Briefly disable the transition, so flipping the previous card back is
    // not animated and does not show the new answer through it.
    flashcardInner.style.transition = "none";
    flipped = false;
    flashcardEl.classList.remove("flipped");

    const dir = state.direction;
    el("flipPos").textContent = `${promptFlag(dir)} ${posLabel(d.pos)}`;
    // Mark the language per side, so screen readers do not read Spanish
    // words with German pronunciation.
    const promptLang = dir === "es-de" ? "es" : "de";
    const answerLang = dir === "es-de" ? "de" : "es";
    el("flipFront").lang = promptLang;
    el("flipBack").lang = answerLang;
    el("flipFront").textContent = promptWord(d, dir);
    el("flipBack").textContent = answerPrimary(d, dir);
    el("flipEx").textContent = d.ex || "";
    el("flipExDe").textContent = d.exDe || "";
    el("gradeRow").classList.add("hidden-until-flip");

    void flashcardInner.offsetWidth; // force a reflow before re-enabling the transition
    flashcardInner.style.transition = "";

    const c = ensureCard(d.es);
    const preview = SRS.previewIntervals(c, { desiredRetention: 0.9, now: Date.now() });
    el("iv1").textContent = preview[1];
    el("iv2").textContent = preview[2];
    el("iv3").textContent = preview[3];
    el("iv4").textContent = preview[4];
  }
  function toggleFlip() {
    flipped = !flipped;
    flashcardEl.classList.toggle("flipped", flipped);
    flashcardEl.setAttribute("aria-pressed", flipped ? "true" : "false");
    el("gradeRow").classList.toggle("hidden-until-flip", !flipped);
  }
  flashcardEl.addEventListener("click", toggleFlip);
  document.querySelectorAll(".grade-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!flipped) return;
      const grade = Number(btn.dataset.grade);
      gradeCurrent(grade, grade >= 3);
    });
  });

  // --- Multiple choice ---
  function renderMC(d) {
    const dir = state.direction;
    el("mcPos").textContent = `${promptFlag(dir)} ${posLabel(d.pos)}`;
    el("mcPrompt").lang = dir === "es-de" ? "es" : "de";
    el("mcPrompt").textContent = promptWord(d, dir);
    const correct = answerPrimary(d, dir);
    // Distractors must match neither the answer nor an equivalent synonym -
    // otherwise two correct options would be on offer and the deduplication
    // would leave only three fields in the end.
    const accepted = new Set(answerAlternatives(d, dir));
    const collect = (candidates, into) => {
      for (const x of shuffle([...candidates])) {
        if (into.length >= 3) break;
        const opt = answerPrimary(x, dir);
        if (accepted.has(norm(opt)) || into.includes(opt)) continue;
        into.push(opt);
      }
      return into;
    };
    let options = collect(DECK.filter((x) => x.es !== d.es && x.pos === d.pos), []);
    if (options.length < 3) collect(DECK.filter((x) => x.es !== d.es), options);
    options.push(correct);
    options = shuffle(options);

    const grid = el("mcGrid");
    grid.innerHTML = "";
    options.forEach((opt, i) => {
      const b = document.createElement("button");
      b.className = "mc-option";
      b.dataset.answer = opt;
      b.innerHTML = `<span class="mc-key">${i + 1}</span>`;
      b.append(document.createTextNode(opt));
      if (dir === "de-es") b.lang = "es";
      b.addEventListener("click", () => {
        lastTyped = opt;
        const ok = accepted.has(norm(opt));
        grid.querySelectorAll(".mc-option").forEach((o) => {
          o.classList.add("disabled");
          if (o.dataset.answer === correct) o.classList.add("correct");
          else if (o === b && !ok) o.classList.add("wrong");
        });
        const continueBtn = el("sessionContinueBtn");
        continueBtn.hidden = false;
        continueBtn.focus();
        continueBtn.onclick = () => gradeCurrent(ok ? 3 : 1, ok);
      });
      grid.appendChild(b);
    });
  }

  // --- Typing ---
  function renderType(d) {
    const dir = state.direction;
    el("typePos").textContent = `${promptFlag(dir)} ${posLabel(d.pos)}`;
    el("typePrompt").lang = dir === "es-de" ? "es" : "de";
    el("typePrompt").textContent = promptWord(d, dir);
    const input = el("typeInput");
    input.value = "";
    input.className = "type-input";
    input.disabled = false;
    input.placeholder = dir === "es-de" ? "Deutsche Übersetzung eintippen …" : "Übersetzung auf Spanisch eintippen …";
    input.lang = dir === "es-de" ? "de" : "es";
    el("typeFeedback").textContent = "";
    el("typeFeedback").className = "type-feedback";
    setTimeout(() => input.focus(), 50);

    const check = () => {
      const verdict = judgeAnswer(input.value, answerAlternatives(d, dir));
      lastTyped = input.value.trim();
      const ok = verdict !== "wrong";
      const solution = answerPrimary(d, dir);
      input.className = "type-input " + (ok ? "correct" : "wrong");
      const fb = el("typeFeedback");
      fb.className = "type-feedback " + (ok ? "correct" : "wrong");
      fb.textContent = verdict === "exact" ? "Richtig!"
        : verdict === "close" ? `Fast — richtig geschrieben: ${solution}`
        : `Richtig wäre: ${solution}`;
      el("typeCheckBtn").disabled = true;
      input.disabled = true;
      const continueBtn = el("sessionContinueBtn");
      continueBtn.hidden = false;
      continueBtn.focus();
      // A typo counts as "hard", not as forgotten.
      const grade = verdict === "exact" ? 3 : verdict === "close" ? 2 : 1;
      continueBtn.onclick = () => gradeCurrent(grade, ok);
    };
    el("typeCheckBtn").onclick = check;
    input.onkeydown = (e) => {
      if (e.key !== "Enter") return;
      // Do not pass it on: the global Enter handler would otherwise use the
      // same keypress to hit "next" right away - the feedback would never be
      // seen.
      e.preventDefault();
      e.stopPropagation();
      check();
    };
    el("typeCheckBtn").disabled = false;
  }
  function posLabel(pos) {
    return {
      noun: "Substantiv", verb: "Verb", adj: "Adjektiv", adv: "Adverb", phrase: "Redewendung",
      num: "Zahlwort", pron: "Pronomen", prep: "Präposition", conj: "Konjunktion",
    }[pos] || pos;
  }
  function germanPrimary(de) { return de.split("|")[0]; }

  // ---------- Drill direction ----------
  function promptWord(d, dir) { return dir === "es-de" ? d.es : germanPrimary(d.de); }
  function answerPrimary(d, dir) { return dir === "es-de" ? germanPrimary(d.de) : d.es; }
  function promptFlag(dir) { return dir === "es-de" ? "🇪🇸" : "🇩🇪"; }

  /* Several Spanish words share the same primary German meaning
     ("gehen" -> ir/andar/caminar). Going DE->ES, every word of the same group
     is therefore correct; otherwise a correct answer would count as a mistake
     and demote the card. */
  let synonymIndex = null;
  function germanGroup(d) {
    if (!synonymIndex) {
      synonymIndex = new Map();
      DECK.forEach((x) => {
        const key = norm(germanPrimary(x.de));
        if (!synonymIndex.has(key)) synonymIndex.set(key, []);
        synonymIndex.get(key).push(x);
      });
    }
    return synonymIndex.get(norm(germanPrimary(d.de))) || [d];
  }
  function answerAlternatives(d, dir) {
    return dir === "es-de"
      ? d.de.split("|").map(norm)
      : germanGroup(d).map((x) => norm(x.es));
  }

  const judgeAnswer = (typed, alternatives) => TEXT.judge(typed, alternatives);

  let lastTyped = null;   // last input, for the log

  function gradeCurrent(grade, correct) {
    const item = currentItem();
    const c = ensureCard(item.deck.es);
    if (c.state === "new") {
      const k = todayKey();
      state.newIntroducedOn[k] = (state.newIntroducedOn[k] || 0) + 1;
    }
    cards[item.deck.es] = SRS.review(c, grade, { desiredRetention: 0.9, mode: item.mode });
    session.reviewed += 1;
    if (correct) session.correct += 1;
    logReview(correct);
    logEvent({
      kind: "vocab", id: item.deck.es, dir: state.direction, mode: item.mode,
      grade, ok: correct, typed: lastTyped, expected: answerPrimary(item.deck, state.direction),
    });
    lastTyped = null;
    save(item.deck.es);

    // "Again" -> mix the card back in later in the same session
    if (grade === 1 && !item.requeued) {
      const reinsertAt = Math.min(session.queue.length, session.idx + 3 + Math.floor(Math.random() * 3));
      session.queue.splice(reinsertAt, 0, { deck: item.deck, mode: "flip", requeued: true });
    }

    session.idx += 1;
    renderCurrentCard();
  }

  function finishSession() {
    const reviewed = session ? session.reviewed : 0;
    const correct = session ? session.correct : 0;
    el("doneReviewedLabel").textContent = "Karten geübt";
    el("doneReviewed").textContent = reviewed;
    el("doneAccuracy").textContent = reviewed ? `${Math.round((correct / reviewed) * 100)}%` : "–";
    el("doneStreak").textContent = state.streak;
    el("doneStreakBlock").hidden = false;
    el("sessionContinueBtn").hidden = true;
    session = null;
    syncFolder();
    doneReturnView = "home";
    showView("done");
  }

  // ---------- Conjugation ----------
  let conjSelectedTenses = new Set();
  let conjVerbSet = "irregular";
  let conjSession = null; // { queue: [{infinitive, tense, person}], idx, reviewed, correct }

  function conjVerbsForSet(setName) {
    if (setName === "irregular") return CONJUGATE.ALL_VERBS.filter((v) => v.irregular);
    if (setName === "regular") return CONJUGATE.ALL_VERBS.filter((v) => !v.irregular);
    return CONJUGATE.ALL_VERBS;
  }

  function renderConjTable(infinitive) {
    const verb = CONJUGATE.findVerb(infinitive);
    if (!verb) { el("conjTable").innerHTML = ""; return; }
    const forms = CONJUGATE.getForms(verb);
    el("conjTable").innerHTML = CONJUGATE.TENSES.map((t) => `
      <div class="conj-tense-block">
        <div class="conj-tense-title">${CONJUGATE.TENSE_LABELS[t]}</div>
        <div class="conj-tense-explanation">${CONJUGATE.TENSE_EXPLANATIONS[t]}</div>
        <div class="conj-pattern">${verb.irregular
          ? "⚠️ Unregelmäßig — weicht vom Muster ab, am besten auswendig lernen."
          : CONJUGATE.regularPatternExplanation(verb.infinitive, verb.group, t)}</div>
        <div class="conj-form-grid">
          ${forms[t].map((f, i) => `<div class="conj-form-row"><span class="conj-form-person">${CONJUGATE.PERSON_LABELS[i]}</span><span class="conj-form-value">${f}</span></div>`).join("")}
        </div>
      </div>
    `).join("");
  }

  function renderConjOverview() {
    const select = el("conjVerbSelect");
    if (!select.dataset.filled) {
      const optGroup = (label, verbs) => {
        const og = document.createElement("optgroup");
        og.label = label;
        verbs.forEach((v) => {
          const o = document.createElement("option");
          o.value = v.infinitive;
          o.textContent = `${v.infinitive} — ${v.de}`;
          og.appendChild(o);
        });
        return og;
      };
      select.appendChild(optGroup("Unregelmäßig", CONJUGATE.ALL_VERBS.filter((v) => v.irregular)));
      select.appendChild(optGroup("Regelmäßig", CONJUGATE.ALL_VERBS.filter((v) => !v.irregular)));
      select.dataset.filled = "1";
      select.addEventListener("change", (e) => renderConjTable(e.target.value));
    }
    renderConjTable(select.value || select.options[0]?.value);

    const tenseChips = el("tenseChips");
    if (!tenseChips.dataset.filled) {
      tenseChips.innerHTML = CONJUGATE.TENSES.map((t) =>
        `<button class="chip" data-tense="${t}" title="${CONJUGATE.TENSE_EXPLANATIONS[t].replace(/"/g, "&quot;")}">${CONJUGATE.TENSE_LABELS[t]}</button>`
      ).join("");
      tenseChips.addEventListener("click", (e) => {
        const btn = e.target.closest(".chip");
        if (!btn) return;
        const t = btn.dataset.tense;
        if (conjSelectedTenses.has(t)) conjSelectedTenses.delete(t);
        else conjSelectedTenses.add(t);
        state.conjTenses = [...conjSelectedTenses];
        save();
        renderConjOverview();
      });
      tenseChips.dataset.filled = "1";
    }
    document.querySelectorAll("#tenseChips .chip").forEach((c) => c.classList.toggle("active", conjSelectedTenses.has(c.dataset.tense)));
    document.querySelectorAll("#verbsetChips .chip").forEach((c) => c.classList.toggle("active", c.dataset.set === conjVerbSet));

    const verbCount = conjVerbsForSet(conjVerbSet).length;
    const tenseCount = conjSelectedTenses.size;
    el("conjHint").textContent = tenseCount === 0
      ? "Wähle mindestens eine Zeit aus."
      : `${verbCount} Verben × ${tenseCount} Zeit(en) × 6 Personen`;
    el("startConjBtn").disabled = tenseCount === 0;
  }
  el("verbsetChips").addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    conjVerbSet = btn.dataset.set;
    state.conjVerbSet = conjVerbSet;
    save();
    renderConjOverview();
  });

  /**
   * Priority of a drill unit. Mistakes weigh heaviest, then unpractised
   * material, then whatever has not been reviewed in a long time. The random
   * share keeps every session from starting with the same list.
   */
  function practiceScore(rec) {
    if (!rec || !rec.attempts) return 4 + Math.random() * 2;      // never practised
    const wrongWeight = rec.wrongCount * 2 + (rec.lastResult === "wrong" ? 3 : 0);
    const staleness = Math.min(3, (Date.now() - rec.lastAt) / (7 * DAY));
    const mastered = rec.wrongCount === 0 ? -2 : 0;
    return wrongWeight + staleness + mastered + Math.random() * 2;
  }

  function buildConjQueue() {
    const tenses = [...conjSelectedTenses];
    const items = [];
    conjVerbsForSet(conjVerbSet).forEach((v) => {
      tenses.forEach((t) => {
        for (let p = 0; p < 6; p++) items.push({ infinitive: v.infinitive, tense: t, person: p });
      });
    });
    return items
      .map((it) => ({ it, score: practiceScore(state.conjCards[`${it.infinitive}|${it.tense}|${it.person}`]) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 40)
      .map((x) => x.it);
  }

  el("startConjBtn").addEventListener("click", () => {
    const queue = shuffle(buildConjQueue());
    if (!queue.length) return;
    conjSession = { queue, idx: 0, reviewed: 0, correct: 0 };
    touchStreak();
    showView("conjsession");
    renderConjItem();
  });
  el("exitConjBtn").addEventListener("click", () => { conjSession = null; el("conjContinueBtn").hidden = true; showView("conj"); });

  function renderConjItem() {
    if (!conjSession || conjSession.idx >= conjSession.queue.length) return finishConjSession();
    const item = conjSession.queue[conjSession.idx];
    const verb = CONJUGATE.findVerb(item.infinitive);
    el("conjIdx").textContent = conjSession.idx + 1;
    el("conjTotal").textContent = conjSession.queue.length;
    el("conjProgressBar").style.width = progressWidth(conjSession);
    el("conjTenseLabel").textContent = CONJUGATE.TENSE_LABELS[item.tense];
    el("conjInfinitive").textContent = verb.infinitive;
    el("conjPersonLabel").textContent = CONJUGATE.PERSON_LABELS[item.person];
    const pattern = verb.irregular
      ? "⚠️ Unregelmäßig — weicht vom Muster ab."
      : CONJUGATE.regularPatternExplanation(verb.infinitive, verb.group, item.tense);
    el("conjDrillExplanation").innerHTML = `${CONJUGATE.TENSE_EXPLANATIONS[item.tense]}<br><strong>${pattern}</strong>`;
    const input = el("conjInput");
    input.value = "";
    input.className = "type-input";
    input.disabled = false;
    el("conjFeedback").textContent = "";
    el("conjFeedback").className = "type-feedback";
    el("conjScore").textContent = `${conjSession.correct} / ${conjSession.reviewed} richtig`;
    el("conjCheckBtn").disabled = false;
    el("conjCheckBtn").hidden = false;
    el("conjContinueBtn").hidden = true;
    setTimeout(() => input.focus(), 50);
  }

  function logConjAttempt(item, ok, correctForm, typed) {
    const key = `${item.infinitive}|${item.tense}|${item.person}`;
    if (!state.conjCards[key]) state.conjCards[key] = { attempts: 0, correct: 0, wrongCount: 0, lastResult: null, lastAt: 0 };
    const c = state.conjCards[key];
    c.attempts += 1;
    if (ok) c.correct += 1; else c.wrongCount += 1;
    c.lastResult = ok ? "correct" : "wrong";
    c.lastAt = Date.now();

    const k = todayKey();
    if (!state.conjLog[k]) state.conjLog[k] = { reviewed: 0, correct: 0 };
    state.conjLog[k].reviewed += 1;
    if (ok) state.conjLog[k].correct += 1;

    logEvent({
      kind: "conj", verb: item.infinitive, tense: item.tense, person: item.person,
      ok, typed: typed.trim(), expected: correctForm,
    });
    save();
  }

  function checkConjAnswer() {
    if (!conjSession) return;
    const item = conjSession.queue[conjSession.idx];
    const verb = CONJUGATE.findVerb(item.infinitive);
    const forms = CONJUGATE.getForms(verb);
    const correctForm = forms[item.tense][item.person];
    const input = el("conjInput");
    const ok = norm(input.value) === norm(correctForm);
    input.className = "type-input " + (ok ? "correct" : "wrong");
    const fb = el("conjFeedback");
    fb.className = "type-feedback " + (ok ? "correct" : "wrong");
    fb.textContent = ok ? "¡Correcto!" : `Richtig wäre: ${correctForm}`;
    input.disabled = true;
    el("conjCheckBtn").disabled = true;
    el("conjCheckBtn").hidden = true;
    logConjAttempt(item, ok, correctForm, input.value);
    conjSession.reviewed += 1;
    if (ok) conjSession.correct += 1;
    if (!ok && !item.requeued) {
      const reinsertAt = Math.min(conjSession.queue.length, conjSession.idx + 3 + Math.floor(Math.random() * 3));
      conjSession.queue.splice(reinsertAt, 0, { ...item, requeued: true });
    }
    el("conjContinueBtn").hidden = false;
  }
  el("conjCheckBtn").addEventListener("click", checkConjAnswer);
  el("conjContinueBtn").addEventListener("click", () => { if (!conjSession) return; conjSession.idx += 1; renderConjItem(); });
  el("conjInput").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();   // see renderType: otherwise one Enter both checks and advances
    if (!el("conjCheckBtn").disabled && !el("conjCheckBtn").hidden) checkConjAnswer();
  });

  function finishConjSession() {
    const reviewed = conjSession ? conjSession.reviewed : 0;
    const correct = conjSession ? conjSession.correct : 0;
    el("doneReviewedLabel").textContent = "Formen geübt";
    el("doneReviewed").textContent = reviewed;
    el("doneAccuracy").textContent = reviewed ? `${Math.round((correct / reviewed) * 100)}%` : "–";
    el("doneStreakBlock").hidden = true;
    el("conjContinueBtn").hidden = true;
    conjSession = null;
    syncFolder();
    doneReturnView = "conj";
    showView("done");
  }

  // ---------- Grammar ----------
  let grammarSelectedCategories = new Set();
  let grammarSession = null; // { queue: [item...], idx, reviewed, correct }

  function renderGrammarOverview() {
    const chips = el("grammarCategoryChips");
    if (!chips.dataset.filled) {
      chips.innerHTML = GRAMMAR.CATEGORIES.map((c) =>
        `<button class="chip" data-cat="${c}" title="${GRAMMAR.CATEGORY_EXPLANATIONS[c].replace(/"/g, "&quot;")}">${GRAMMAR.CATEGORY_LABELS[c]}</button>`
      ).join("");
      chips.addEventListener("click", (e) => {
        const btn = e.target.closest(".chip");
        if (!btn) return;
        const c = btn.dataset.cat;
        if (grammarSelectedCategories.has(c)) grammarSelectedCategories.delete(c);
        else grammarSelectedCategories.add(c);
        state.grammarCategories = [...grammarSelectedCategories];
        save();
        renderGrammarOverview();
      });
      chips.dataset.filled = "1";
    }
    document.querySelectorAll("#grammarCategoryChips .chip").forEach((c) => c.classList.toggle("active", grammarSelectedCategories.has(c.dataset.cat)));

    const selected = [...grammarSelectedCategories];
    el("grammarCategoryExplanation").innerHTML = selected.length
      ? selected.map((c) => `<strong>${GRAMMAR.CATEGORY_LABELS[c]}:</strong> ${GRAMMAR.CATEGORY_EXPLANATIONS[c]}`).join("<br><br>")
      : "Wähle mindestens eine Kategorie aus.";

    const itemCount = selected.reduce((sum, c) => sum + GRAMMAR.itemsForCategory(c).length, 0);
    el("startGrammarBtn").disabled = itemCount === 0;
  }

  function buildGrammarQueue() {
    const items = [];
    grammarSelectedCategories.forEach((c) => items.push(...GRAMMAR.itemsForCategory(c)));
    return items
      .map((it) => ({ it, score: practiceScore(state.grammarCards[it.id]) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 40)
      .map((x) => x.it);
  }

  el("startGrammarBtn").addEventListener("click", () => {
    const queue = shuffle(buildGrammarQueue());
    if (!queue.length) return;
    grammarSession = { queue, idx: 0, reviewed: 0, correct: 0 };
    touchStreak();
    showView("grammarsession");
    renderGrammarItem();
  });
  el("exitGrammarBtn").addEventListener("click", () => { grammarSession = null; el("grammarContinueBtn").hidden = true; showView("grammar"); });

  function logGrammarAttempt(item, ok, chosen) {
    if (!state.grammarCards[item.id]) state.grammarCards[item.id] = { attempts: 0, correct: 0, wrongCount: 0, lastResult: null, lastAt: 0 };
    const c = state.grammarCards[item.id];
    c.attempts += 1;
    if (ok) c.correct += 1; else c.wrongCount += 1;
    c.lastResult = ok ? "correct" : "wrong";
    c.lastAt = Date.now();

    const k = todayKey();
    if (!state.grammarLog[k]) state.grammarLog[k] = { reviewed: 0, correct: 0 };
    state.grammarLog[k].reviewed += 1;
    if (ok) state.grammarLog[k].correct += 1;

    logEvent({
      kind: "grammar", id: item.id, category: item.category,
      ok, chosen, expected: item.answer,
    });
    save();
  }

  function renderGrammarItem() {
    if (!grammarSession || grammarSession.idx >= grammarSession.queue.length) return finishGrammarSession();
    const item = grammarSession.queue[grammarSession.idx];
    el("grammarIdx").textContent = grammarSession.idx + 1;
    el("grammarTotal").textContent = grammarSession.queue.length;
    el("grammarProgressBar").style.width = progressWidth(grammarSession);
    el("grammarCategoryLabel").textContent = GRAMMAR.CATEGORY_LABELS[item.category];
    el("grammarPrompt").textContent = item.prompt;
    el("grammarExplanation").textContent = "";
    el("grammarScore").textContent = `${grammarSession.correct} / ${grammarSession.reviewed} richtig`;
    el("grammarContinueBtn").hidden = true;

    const grid = el("grammarGrid");
    grid.innerHTML = "";
    shuffle([...item.options]).forEach((opt) => {
      const b = document.createElement("button");
      b.className = "mc-option";
      b.textContent = opt;
      b.addEventListener("click", () => {
        const ok = opt === item.answer;
        grid.querySelectorAll(".mc-option").forEach((o) => {
          o.classList.add("disabled");
          if (o.textContent === item.answer) o.classList.add("correct");
          else if (o === b && !ok) o.classList.add("wrong");
        });
        el("grammarExplanation").textContent = item.explanation;
        logGrammarAttempt(item, ok, opt);
        grammarSession.reviewed += 1;
        if (ok) grammarSession.correct += 1;
        if (!ok && !item.requeued) {
          const reinsertAt = Math.min(grammarSession.queue.length, grammarSession.idx + 3 + Math.floor(Math.random() * 3));
          grammarSession.queue.splice(reinsertAt, 0, { ...item, requeued: true });
        }
        el("grammarContinueBtn").hidden = false;
      });
      grid.appendChild(b);
    });
  }
  el("grammarContinueBtn").addEventListener("click", () => { if (!grammarSession) return; grammarSession.idx += 1; renderGrammarItem(); });

  function finishGrammarSession() {
    const reviewed = grammarSession ? grammarSession.reviewed : 0;
    const correct = grammarSession ? grammarSession.correct : 0;
    el("doneReviewedLabel").textContent = "Fragen beantwortet";
    el("doneReviewed").textContent = reviewed;
    el("doneAccuracy").textContent = reviewed ? `${Math.round((correct / reviewed) * 100)}%` : "–";
    el("doneStreakBlock").hidden = true;
    el("grammarContinueBtn").hidden = true;
    grammarSession = null;
    syncFolder();
    doneReturnView = "grammar";
    showView("done");
  }

  // ---------- Playing exercise sets ----------
  /* The only flow that already runs on the generic DRILL mechanics. A new
     item type needs just one more renderer here and a check function in
     packs.js. */
  let packSession = null;
  let packLoadErrors = [];

  const PACK_RENDERERS = {
    choice(item, onAnswer) {
      const grid = el("packGrid");
      grid.hidden = false;
      grid.innerHTML = "";
      shuffle([...item.options]).forEach((opt, i) => {
        const b = document.createElement("button");
        b.className = "mc-option";
        b.dataset.answer = opt;
        b.lang = item.lang || "es";
        b.innerHTML = `<span class="mc-key">${i + 1}</span>`;
        b.append(document.createTextNode(opt));
        b.addEventListener("click", () => {
          grid.querySelectorAll(".mc-option").forEach((o) => {
            o.classList.add("disabled");
            if (o.dataset.answer === item.answer) o.classList.add("correct");
            else if (o === b) o.classList.add("wrong");
          });
          onAnswer(PACKS.checkAnswer(item, opt), opt);
        });
        grid.appendChild(b);
      });
    },

    typed(item, onAnswer) {
      const wrap = el("packTypedWrap");
      wrap.hidden = false;
      const input = el("packInput");
      input.value = "";
      input.className = "type-input";
      input.disabled = false;
      input.lang = item.type === "translate" ? (item.to || "es") : (item.lang || "es");
      input.placeholder = item.hint ? `Tipp: ${item.hint}` : "Antwort eintippen …";
      el("packCheckBtn").disabled = false;
      el("packCheckBtn").hidden = false;
      setTimeout(() => input.focus(), 50);

      const check = () => {
        const verdict = PACKS.checkAnswer(item, input.value);
        input.className = "type-input " + (verdict === "wrong" ? "wrong" : "correct");
        input.disabled = true;
        el("packCheckBtn").disabled = true;
        el("packCheckBtn").hidden = true;
        onAnswer(verdict, input.value.trim());
      };
      el("packCheckBtn").onclick = check;
      input.onkeydown = (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        e.stopPropagation();   // otherwise one Enter both checks and advances
        if (!input.disabled) check();
      };
    },
  };
  const rendererFor = (item) => (item.type === "choice" ? PACK_RENDERERS.choice : PACK_RENDERERS.typed);

  function startPack(pack) {
    const key = (it) => `${pack.id}|${pack.items.indexOf(it)}`;
    const chosen = DRILL.select(pack.items, key, state.packCards || {}, 40);
    packSession = DRILL.create(chosen, { meta: { packId: pack.id, title: pack.title } });
    touchStreak();
    showView("packsession");
    renderPackItem();
  }

  function renderPackItem() {
    if (DRILL.isDone(packSession)) return finishPackSession();
    const item = DRILL.current(packSession);
    el("packIdx").textContent = packSession.idx + 1;
    el("packTotal").textContent = packSession.items.length;
    el("packProgressBar").style.width = DRILL.progress(packSession);
    el("packTypeLabel").textContent = PACKS.typeLabel(item.type);
    el("packPrompt").textContent = item.prompt;
    el("packPrompt").lang = item.type === "translate" ? (item.from || "de") : (item.lang || "es");
    el("packFeedback").textContent = "";
    el("packFeedback").className = "type-feedback";
    el("packExplanation").textContent = "";
    el("packContinueBtn").hidden = true;
    el("packScore").textContent = `${packSession.correct} / ${packSession.reviewed} richtig`;
    el("packGrid").hidden = true;
    el("packTypedWrap").hidden = true;

    rendererFor(item)(item, (verdict, given) => onPackAnswer(item, verdict, given));
  }

  function onPackAnswer(item, verdict, given) {
    const ok = verdict !== "wrong";
    const solution = PACKS.acceptedAnswers(item)[0];
    const fb = el("packFeedback");
    fb.className = "type-feedback " + (ok ? "correct" : "wrong");
    fb.textContent = verdict === "exact" ? "Richtig!"
      : verdict === "close" ? `Fast — richtig geschrieben: ${solution}`
      : `Richtig wäre: ${solution}`;
    el("packExplanation").textContent = item.explanation || "";

    const packId = packSession.meta.packId;
    const key = `${packId}|${(packs.find((p) => p.id === packId) || { items: [] }).items.indexOf(item)}`;
    if (!state.packCards) state.packCards = {};
    const rec = state.packCards[key] || (state.packCards[key] = { attempts: 0, correct: 0, wrongCount: 0, lastResult: null, lastAt: 0 });
    rec.attempts += 1;
    if (ok) rec.correct += 1; else rec.wrongCount += 1;
    rec.lastResult = ok ? "correct" : "wrong";
    rec.lastAt = Date.now();

    const k = todayKey();
    if (!state.packLog) state.packLog = {};
    if (!state.packLog[k]) state.packLog[k] = { reviewed: 0, correct: 0 };
    state.packLog[k].reviewed += 1;
    if (ok) state.packLog[k].correct += 1;

    logEvent({ kind: "pack", packId, itemType: item.type, prompt: item.prompt, ok, typed: given, expected: solution });
    DRILL.record(packSession, ok);
    save();
    el("packScore").textContent = `${packSession.correct} / ${packSession.reviewed} richtig`;
    const cont = el("packContinueBtn");
    cont.hidden = false;
    cont.focus();
  }

  el("packContinueBtn").addEventListener("click", () => {
    if (!packSession) return;
    DRILL.advance(packSession);
    renderPackItem();
  });
  el("exitPackBtn").addEventListener("click", () => {
    packSession = null;
    el("packContinueBtn").hidden = true;
    showView("packs");
  });

  function finishPackSession() {
    const reviewed = packSession ? packSession.reviewed : 0;
    el("doneReviewedLabel").textContent = "Aufgaben gelöst";
    el("doneReviewed").textContent = reviewed;
    el("doneAccuracy").textContent = DRILL.accuracy(packSession) == null ? "–" : `${DRILL.accuracy(packSession)}%`;
    el("doneStreakBlock").hidden = true;
    el("packContinueBtn").hidden = true;
    packSession = null;
    doneReturnView = "packs";
    showView("done");
    syncFolder();
  }

  function renderPacks() {
    const list = el("packList");
    const msg = el("packMessage");
    const errBox = el("packErrors");

    errBox.hidden = !packLoadErrors.length;
    if (packLoadErrors.length) {
      errBox.innerHTML = `<strong>${packLoadErrors.length} Datei(en) übersprungen:</strong><ul>` +
        packLoadErrors.slice(0, 8).map((e) => `<li>${esc(e)}</li>`).join("") + "</ul>";
    }

    if (!packs.length) {
      msg.hidden = false;
      msg.innerHTML = "Noch keine Übungen. Ein Agent legt sie über das MCP-Werkzeug " +
        "<code>create_exercise</code> an — sie erscheinen hier von selbst. " +
        "Alternativ eine JSON-Datei importieren.";
      list.innerHTML = "";
      return;
    }
    msg.hidden = true;

    list.innerHTML = packs
      .slice()
      .sort((a, b) => b.addedAt - a.addedAt)
      .map((p) => {
        const done = events.filter((e) => e.kind === "pack" && e.packId === p.id);
        const acc = done.length ? Math.round((done.filter((e) => e.ok).length / done.length) * 100) : null;
        const types = [...new Set(p.items.map((i) => PACKS.typeLabel(i.type)))].join(", ");
        return `<div class="pack-card">
          <div class="pack-card-main">
            <div class="pack-card-title">${esc(p.title)}</div>
            ${p.description ? `<div class="pack-card-desc">${esc(p.description)}</div>` : ""}
            <div class="pack-card-meta">${p.items.length} Aufgaben · ${esc(types)} · von ${esc(p.createdBy)}
              ${acc == null ? "· noch nicht geübt" : `· zuletzt ${acc} % richtig`}</div>
          </div>
          <div class="pack-card-actions">
            <button class="btn-primary pack-start" data-pack="${esc(p.id)}">Üben</button>
            <button class="icon-btn pack-delete" data-pack="${esc(p.id)}" aria-label="Übung entfernen">🗑</button>
          </div>
        </div>`;
      }).join("");

    list.querySelectorAll(".pack-start").forEach((b) => b.addEventListener("click", () => {
      const pack = packs.find((p) => p.id === b.dataset.pack);
      if (pack) startPack(pack);
    }));
    list.querySelectorAll(".pack-delete").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm("Diese Übung aus der App entfernen? Die Datei im Ordner bleibt.")) return;
      const target = packs.find((p) => p.id === b.dataset.pack);
      await STORE.deletePack(b.dataset.pack, target && target.source);
      packs = await STORE.allPacks();
      renderPacks();
    }));
  }

  el("reloadPacksBtn").addEventListener("click", async () => {
    const btn = el("reloadPacksBtn");
    btn.disabled = true;
    btn.textContent = "Lade …";
    try {
      const { count, errors } = await loadPacksFromFolder();
      const msg = el("packMessage");
      msg.hidden = false;
      msg.textContent = `${count} ${count === 1 ? "Übungssatz" : "Übungssätze"} gelesen` +
        (errors.length ? `, ${errors.length} übersprungen.` : ".");
    } finally {
      btn.textContent = "Aus Ordner neu laden";
      renderSyncStatus();
    }
  });

  el("importPackInput").addEventListener("change", async (e) => {
    const errors = [];
    let count = 0;
    for (const file of e.target.files) {
      try {
        await STORE.savePack(JSON.parse(await file.text()));
        count += 1;
      } catch (err) { errors.push(`${file.name}: ${err.message}`); }
    }
    packs = await STORE.allPacks();
    packLoadErrors = errors;
    renderPacks();
    const msg = el("packMessage");
    msg.hidden = false;
    msg.textContent = `${count} ${count === 1 ? "Übungssatz" : "Übungssätze"} importiert` +
      (errors.length ? `, ${errors.length} abgelehnt.` : ".");
    e.target.value = "";
  });

  // ---------- Browse ----------
  function stateEmoji(c) {
    if (!c || c.state === "new") return "⚪";
    if (c.state === "learning" || c.state === "relearning") return "🟡";
    if (c.stability >= 21) return "🟢";
    return "🔵";
  }
  function populateBrowseFilters() {
    const topics = [...new Set(DECK.map((d) => d.topic))].sort();
    const levels = [...new Set(DECK.map((d) => d.level))].sort();
    const tSel = el("browseTopic"), lSel = el("browseLevel");
    if (tSel.children.length === 1) topics.forEach((t) => tSel.insertAdjacentHTML("beforeend", `<option value="${t}">${t}</option>`));
    if (lSel.children.length === 1) levels.forEach((l) => lSel.insertAdjacentHTML("beforeend", `<option value="${l}">${l}</option>`));
  }
  function renderBrowse() {
    populateBrowseFilters();
    const q = el("browseSearch").value.trim().toLowerCase();
    const topic = el("browseTopic").value;
    const level = el("browseLevel").value;
    const list = el("browseList");
    const filtered = DECK.filter((d) => {
      if (topic && d.topic !== topic) return false;
      if (level && d.level !== level) return false;
      if (q && !(d.es.toLowerCase().includes(q) || d.de.toLowerCase().includes(q))) return false;
      return true;
    });
    if (!filtered.length) {
      list.innerHTML = `<div class="empty-state">Keine Vokabeln gefunden.</div>`;
      return;
    }
    list.innerHTML = filtered.map((d) => {
      const c = cards[d.es];
      return `<div class="browse-item">
        <span class="bi-state">${stateEmoji(c)}</span>
        <div class="bi-main"><div class="bi-es" lang="es">${esc(d.es)}</div><div class="bi-de">${esc(d.de.replace(/\|/g, ", "))}</div></div>
        <span class="bi-level">${esc(d.level)}</span>
      </div>`;
    }).join("");
  }
  ["browseSearch", "browseTopic", "browseLevel"].forEach((id) => {
    el(id).addEventListener("input", renderBrowse);
    el(id).addEventListener("change", renderBrowse);
  });

  // ---------- Stats ----------
  function renderStats() {
    const totalReviews = Object.values(state.log).reduce((s, d) => s + d.reviewed, 0);
    el("statTotalReviews").textContent = totalReviews;

    const last30 = last30Keys();
    let rev = 0, cor = 0;
    last30.forEach((k) => { const d = state.log[k]; if (d) { rev += d.reviewed; cor += d.correct; } });
    el("statAccuracy").textContent = rev ? `${Math.round((cor / rev) * 100)}%` : "–";
    el("statStreak").textContent = state.streak;
    el("statMature").textContent = matureCount();

    // Bar chart of the last 14 days
    const last14 = last30.slice(-14);
    const max = Math.max(1, ...last14.map((k) => (state.log[k] ? state.log[k].reviewed : 0)));
    el("barChart").innerHTML = last14.map((k) => {
      const d = state.log[k] || { reviewed: 0 };
      const h = Math.round((d.reviewed / max) * 100);
      const label = k.slice(8, 10);
      return `<div class="bar-col"><div class="bar-fill" style="height:${h}%"></div><div class="bar-day">${label}</div></div>`;
    }).join("");

    // Maturity
    const buckets = { neu: 0, lernend: 0, jung: 0, reif: 0 };
    Object.values(cards).forEach((c) => {
      if (c.state === "new") buckets.neu++;
      else if (c.state === "learning" || c.state === "relearning") buckets.lernend++;
      else if (c.stability >= 21) buckets.reif++;
      else buckets.jung++;
    });
    buckets.neu += DECK.length - Object.keys(cards).length;
    const total = DECK.length;
    const colors = { neu: "var(--surface-2)", lernend: "var(--warn)", jung: "var(--blue)", reif: "var(--good)" };
    const labels = { neu: "Neu", lernend: "Lernend", jung: "Jung", reif: "Gefestigt" };
    el("maturityBar").innerHTML = Object.entries(buckets).map(([k, v]) =>
      `<div style="width:${(v / total) * 100}%; background:${colors[k]}"></div>`
    ).join("");
    el("maturityLegend").innerHTML = Object.entries(buckets).map(([k, v]) =>
      `<span><span class="dot" style="background:${colors[k]}"></span>${labels[k]} (${v})</span>`
    ).join("");

    renderConjStats();
    renderGrammarStats();
  }

  function personShort(personIdx) {
    return ["yo", "tú", "él/ella", "nosotros", "vosotros", "ellos/ellas"][personIdx];
  }
  function timeAgo(ts) {
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 1) return "gerade eben";
    if (mins < 60) return `vor ${mins} Min.`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `vor ${hours} Std.`;
    return `vor ${Math.round(hours / 24)} Tg.`;
  }

  function renderConjStats() {
    const totalConjReviews = Object.values(state.conjLog).reduce((s, d) => s + d.reviewed, 0);
    el("conjStatAttempts").textContent = totalConjReviews;

    const last30 = last30Keys();
    let rev = 0, cor = 0;
    last30.forEach((k) => { const d = state.conjLog[k]; if (d) { rev += d.reviewed; cor += d.correct; } });
    el("conjStatAccuracy").textContent = rev ? `${Math.round((cor / rev) * 100)}%` : "–";

    const recentConj = events.filter((e) => e.kind === "conj").slice(-15).reverse();
    const hasData = recentConj.length > 0;
    el("conjStatsSub").hidden = !hasData;
    el("conjStatsEmpty").style.display = hasData ? "none" : "block";
    if (!hasData) return;

    // Skip entries for verbs/tenses that no longer exist - otherwise a
    // single stale key tears down the whole statistic.
    const mistakes = Object.entries(state.conjCards)
      .filter(([, c]) => c.wrongCount > 0)
      .sort((a, b) => b[1].wrongCount - a[1].wrongCount)
      .map(([key, c]) => {
        const [infinitive, tense, person] = key.split("|");
        const verb = CONJUGATE.findVerb(infinitive);
        const form = verb && CONJUGATE.getForms(verb)[tense]?.[Number(person)];
        return form ? { infinitive, tense, person: Number(person), form, wrongCount: c.wrongCount } : null;
      })
      .filter(Boolean)
      .slice(0, 8);
    el("conjMistakesList").innerHTML = mistakes.length
      ? mistakes.map((m) => `<div class="conj-log-row">
            <span class="conj-log-icon wrong">✗</span>
            <span class="conj-log-main"><strong lang="es">${esc(m.form)}</strong> <span class="conj-log-dim">(${esc(m.infinitive)}, ${CONJUGATE.TENSE_LABELS[m.tense]}, ${personShort(m.person)})</span></span>
            <span class="conj-log-count">${m.wrongCount}×</span>
          </div>`).join("")
      : `<div class="conj-log-empty">Bisher keine wiederholten Fehler — gut gemacht!</div>`;

    el("conjRecentList").innerHTML = recentConj.map((r) => {
      const icon = r.ok ? `<span class="conj-log-icon correct">✓</span>` : `<span class="conj-log-icon wrong">✗</span>`;
      const meta = `${esc(r.verb)}, ${CONJUGATE.TENSE_LABELS[r.tense] || "?"}, ${personShort(r.person)}`;
      const detail = r.ok
        ? `<strong lang="es">${esc(r.expected)}</strong> <span class="conj-log-dim">(${meta})</span>`
        : `<strong lang="es">${esc(r.expected)}</strong> <span class="conj-log-dim">(${meta}) — du: „${esc(r.typed || "–")}“</span>`;
      return `<div class="conj-log-row">${icon}<span class="conj-log-main">${detail}</span><span class="conj-log-time">${timeAgo(r.t)}</span></div>`;
    }).join("");
  }
  /** "Yo ___ profesor." + "soy" -> escaped text with the solution highlighted. */
  function fillGap(prompt, answer) {
    const [before, ...rest] = String(prompt).split("___");
    if (!rest.length) return esc(prompt);
    return `${esc(before)}<strong>${esc(answer)}</strong>${esc(rest.join("___"))}`;
  }

  function last30Keys() {
    const out = [];
    for (let i = 29; i >= 0; i--) out.push(todayKey(Date.now() - i * DAY));
    return out;
  }

  function renderGrammarStats() {
    const totalReviews = Object.values(state.grammarLog).reduce((s, d) => s + d.reviewed, 0);
    el("grammarStatAttempts").textContent = totalReviews;

    const last30 = last30Keys();
    let rev = 0, cor = 0;
    last30.forEach((k) => { const d = state.grammarLog[k]; if (d) { rev += d.reviewed; cor += d.correct; } });
    el("grammarStatAccuracy").textContent = rev ? `${Math.round((cor / rev) * 100)}%` : "–";

    const recentGrammar = events.filter((e) => e.kind === "grammar").slice(-15).reverse();
    const hasData = recentGrammar.length > 0;
    el("grammarStatsSub").hidden = !hasData;
    el("grammarStatsEmpty").style.display = hasData ? "none" : "block";
    if (!hasData) return;

    const mistakes = Object.entries(state.grammarCards)
      .filter(([, c]) => c.wrongCount > 0)
      .sort((a, b) => b[1].wrongCount - a[1].wrongCount)
      .slice(0, 8);
    el("grammarMistakesList").innerHTML = mistakes.length
      ? mistakes.map(([id, c]) => {
          const item = GRAMMAR.findItem(id);
          if (!item) return "";   // the item was removed
          return `<div class="conj-log-row">
            <span class="conj-log-icon wrong">✗</span>
            <span class="conj-log-main" lang="es">${fillGap(item.prompt, item.answer)} <span class="conj-log-dim" lang="de">(${GRAMMAR.CATEGORY_LABELS[item.category]})</span></span>
            <span class="conj-log-count">${c.wrongCount}×</span>
          </div>`;
        }).join("")
      : `<div class="conj-log-empty">Bisher keine wiederholten Fehler — gut gemacht!</div>`;

    el("grammarRecentList").innerHTML = recentGrammar.map((r) => {
      const icon = r.ok ? `<span class="conj-log-icon correct">✓</span>` : `<span class="conj-log-icon wrong">✗</span>`;
      const item = GRAMMAR.findItem(r.id);
      const filled = item ? fillGap(item.prompt, r.expected) : esc(r.expected);
      const label = GRAMMAR.CATEGORY_LABELS[r.category] || "?";
      const detail = r.ok
        ? `${filled} <span class="conj-log-dim">(${label})</span>`
        : `${filled} <span class="conj-log-dim">(${label}) — du: „${esc(r.chosen)}“</span>`;
      return `<div class="conj-log-row">${icon}<span class="conj-log-main">${detail}</span><span class="conj-log-time">${timeAgo(r.t)}</span></div>`;
    }).join("");
  }

  el("exportDataBtn").addEventListener("click", () => {
    const payload = { exportedAt: new Date().toISOString(), deckSize: DECK.length, state, cards };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vokabeltrainer-fortschritt-${todayKey()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  /* Browsers without a folder picker (Brave, Firefox, Safari) still need a
     way to get the report to Claude. Three separate downloads instead of an
     archive - that saves a library, and the browser asks once. */
  function download(name, contents, type) {
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  el("exportBriefingBtn").addEventListener("click", async () => {
    try {
      const [markdown, weak] = await Promise.all([STORE.briefing(), STORE.weaknesses()]);
      download("BRIEFING.md", markdown, "text/markdown");
      download("weaknesses.json", JSON.stringify(weak, null, 2), "application/json");
    } catch (e) {
      alert("Bericht konnte nicht geladen werden: " + e.message);
    }
  });

  /* Report and analysis are produced server-side from SQL views now - the
     app no longer has to upload anything after a session. */
  async function syncFolder() { /* nothing to do */ }

  function renderSyncStatus() {
    const status = el("syncStatus");
    if (!status) return;
    status.textContent = "Mit der Datenbank verbunden. Fortschritt, Antwortprotokoll und Auswertung " +
      "liegen in Postgres; ein Agent liest sie über den MCP-Server und legt dort auch neue Übungen an.";
  }

  // ---------- Keyboard ----------
  const CONTINUE_BTN = {
    session: "sessionContinueBtn",
    conjsession: "conjContinueBtn",
    grammarsession: "grammarContinueBtn",
    packsession: "packContinueBtn",
  };
  /* Only the button of the currently visible drill may react. Otherwise
     Enter reaches the leftover button of a finished drill. */
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sidenav.classList.contains("open")) setNavOpen(false);
  });
  function pressContinue() {
    const btn = el(CONTINUE_BTN[currentView] || "");
    if (!btn || btn.hidden) return false;
    btn.click();
    return true;
  }
  function clickNthOption(gridId, n) {
    const options = el(gridId).querySelectorAll(".mc-option:not(.disabled)");
    if (options[n - 1]) { options[n - 1].click(); return true; }
    return false;
  }

  document.addEventListener("keydown", (e) => {
    // Input fields handle their own keys.
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    // Enter operates the visible "next" button. The case where the same
    // keypress first checks an answer is handled in renderType/conjInput -
    // the field stops propagation there.
    if (e.key === "Enter" && pressContinue()) { e.preventDefault(); return; }

    const inFlip = currentView === "session" && session && currentItem().mode === "flip";
    if (inFlip && (e.key === " " || e.key === "Enter") && tag !== "BUTTON") {
      e.preventDefault();
      toggleFlip();
      return;
    }
    if (inFlip && flipped && ["1", "2", "3", "4"].includes(e.key)) {
      e.preventDefault();
      const grade = Number(e.key);
      gradeCurrent(grade, grade >= 3);
      return;
    }
    if (currentView === "session" && session && currentItem().mode === "mc" && ["1", "2", "3", "4"].includes(e.key)) {
      if (clickNthOption("mcGrid", Number(e.key))) e.preventDefault();
      return;
    }
    if (currentView === "grammarsession" && grammarSession && ["1", "2", "3"].includes(e.key)) {
      if (clickNthOption("grammarGrid", Number(e.key))) e.preventDefault();
      return;
    }
    if (currentView === "packsession" && packSession && ["1", "2", "3", "4", "5", "6"].includes(e.key)) {
      if (clickNthOption("packGrid", Number(e.key))) e.preventDefault();
    }
  });

  /** Show on the start page whether a lesson is ready for today. */
  function markiereLektion() {
    const hinweis = el("lessonHint");
    if (!hinweis) return;
    hinweis.hidden = !LESSON.hatLektion();
  }

  // ---------- Exercise sets from the agent ----------
  async function loadPacksFromFolder() {
    packs = await STORE.allPacks();
    packLoadErrors = [];
    renderPacks();
    return { count: packs.length, errors: [] };
  }

  // ---------- Startup ----------
  async function boot() {
    await STORE.init();
    state = await STORE.loadState();
    cards = await STORE.loadCards();
    events = await STORE.allEvents();
    packs = await STORE.allPacks();

    if (!state.grammarCategories) state.grammarCategories = [...GRAMMAR.CATEGORIES];
    conjSelectedTenses = new Set(state.conjTenses);
    conjVerbSet = state.conjVerbSet;
    grammarSelectedCategories = new Set(state.grammarCategories);

    renderHome();
    renderPacks();
    renderSyncStatus();
    await LESSON.load();
    markiereLektion();

    // When an agent creates an exercise or lesson, it shows up on its own.
    STORE.onExercisesChanged(async () => {
      packs = await STORE.allPacks();
      if (currentView === "packs") renderPacks();
      const badge = el("tab-packs");
      if (badge && currentView !== "packs") badge.classList.add("tab-alert");
    });
    STORE.onLessonsChanged(async () => {
      await LESSON.load();
      if (currentView !== "lesson") el("tab-lesson").classList.add("tab-alert");
      markiereLektion();
    });
    LESSON.setOnSubmitted(markiereLektion);

    stellePositionHer();
  }

  boot().catch((e) => {
    const box = el("bootError");
    box.hidden = false;
    box.textContent = "Keine Verbindung zur Datenbank: " + e.message +
      " — läuft der Server? (docker compose up -d)";
    console.error("Start fehlgeschlagen", e);
  });
})();
