/* Vocabulary trainer - app logic */
(function () {
  "use strict";

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
  const el = (id) => document.getElementById(id);

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
      const c = cards[d.term];
      return c && c.state !== "new" && c.due <= now;
    });
  }
  function allFreshCards() {
    return DECK.filter((d) => !cards[d.term] || cards[d.term].state === "new");
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
  const tabs = document.querySelectorAll(".sidenav .tab");

  /* Four sections. Every other screen belongs to one of them, so its tab
     stays marked while a trainer or the lesson is open. Settings belong to
     none: they open from the course button. */
  const SECTION_OF = {
    lesson: "home", session: "home", done: "home",
    browse: "practice", conj: "practice", grammar: "practice", packs: "practice",
    conjsession: "practice", grammarsession: "practice", packsession: "practice",
    settings: null, welcome: null,
  };
  const SECTION_TITLES = { home: "Heute", practice: "Üben", coach: "Coach", stats: "Fortschritt", settings: "Einstellungen" };

  let currentView = "home";

  function showView(name) {
    const previous = currentView;
    currentView = name;
    Object.entries(views).forEach(([k, v]) => v.classList.toggle("active", k === name));
    const section = name in SECTION_OF ? SECTION_OF[name] : name;
    tabs.forEach((t) => {
      const on = t.dataset.view === section;
      t.classList.toggle("active", on);
      if (on) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
    });
    el("topbarSection").textContent = SECTION_TITLES[section || name] || "";
    document.body.classList.toggle("welcoming", name === "welcome");
    if (previous !== name) window.scrollTo(0, 0);

    if (name === "browse") renderBrowse();
    if (name === "stats") renderStats();
    if (name === "home") { el("tab-home").classList.remove("tab-alert"); renderHome(); }
    if (name === "practice") { el("tab-practice").classList.remove("tab-alert"); renderPractice(); }
    if (name === "conj") renderConjOverview();
    if (name === "grammar") renderGrammarOverview();
    if (name === "packs") { el("tab-practice").classList.remove("tab-alert"); renderPacks(); }
    if (name === "lesson") LESSON.render();
    if (name === "coach") { el("tab-coach").classList.remove("tab-alert"); COACH.render(); }
    if (name === "settings") { COACH.render(); renderSyncStatus(); }
    // Nobody wants the video to keep playing while they drill vocabulary.
    if (name !== "lesson") { LESSON.stoppen(); const f = el("listeningFrame"); if (f && f.src) f.src = f.src; }
  }
  /* After a reload the tab should carry on where you were.
     sessionStorage rather than localStorage: a freshly opened tab starts on
     "Heute" as usual, only reloading the same tab restores. */
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
  /** Switches screens; a running drill is only left after asking. */
  function go(name) {
    const abandon = activeDrill();
    if (abandon) {
      if (!confirm("Die laufende Übung wird beendet. Fortfahren?")) return false;
      abandon();
    }
    showView(name);
    return true;
  }
  tabs.forEach((t) => t.addEventListener("click", () => go(t.dataset.view)));
  el("settingsBtn").addEventListener("click", () => go("settings"));

  /* The course name opens a menu of the courses; picking one switches right
     away. Another course means other content and other progress, so the app
     reloads into it. The list comes from the server. */
  const courseMenu = el("courseMenu");
  let courseList = null;
  courseMenu.addEventListener("beforetoggle", async (e) => {
    if (e.newState !== "open") return;
    if (!courseList) {
      try { courseList = (await STORE.call("GET", "auth/config")).courses || []; } catch (err) { courseList = []; }
    }
    courseMenu.innerHTML = `<div class="course-menu-label">Kurs</div>` + courseList.map((c) => {
      const on = c.id === COURSE.id;
      return `<button class="course-menu-item" role="menuitemradio" aria-checked="${on}" data-course="${esc(c.id)}">
        <span>${esc(c.name)}</span>${on ? icon("check", "icon sm") : ""}</button>`;
    }).join("");
  });
  courseMenu.addEventListener("click", async (e) => {
    const item = e.target.closest("[data-course]");
    if (!item) return;
    if (item.dataset.course === COURSE.id) { courseMenu.hidePopover(); return; }
    const abandon = activeDrill();
    if (abandon && !confirm("Die laufende Übung wird beendet. Fortfahren?")) return;
    item.disabled = true;
    try {
      await STORE.call("PUT", "auth/course", { course: item.dataset.course });
      try { sessionStorage.removeItem("voco:position"); } catch (err) { /* egal */ }
      location.reload();
    } catch (err) {
      item.disabled = false;
      alert("Kurswechsel fehlgeschlagen: " + err.message);
    }
  });
  // Back links on sub-screens, and links to another section.
  document.addEventListener("click", (e) => {
    const back = e.target.closest("[data-back]");
    if (back) { showView(back.dataset.back); return; }
    const link = e.target.closest("[data-goto]");
    if (link) go(link.dataset.goto);
  });

  // ---------- Home ----------

  const icon = (name, cls = "icon") => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

  function renderHome() {
    const due = cardsDueNow().length;
    const fresh = cardsNewAvailable().length;
    el("dueCount").textContent = due;
    el("newCount").textContent = fresh;
    el("totalCount").textContent = DECK.length;
    el("streakCount").textContent = state.streak;
    el("homeSub").textContent = new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });

    document.querySelectorAll(".dir-btn").forEach((b) => b.classList.toggle("active", b.dataset.dir === state.direction));

    const goal = state.dailyGoal;
    const today = state.log[todayKey()] || { reviewed: 0, correct: 0 };
    el("dailyProgress").style.width = `${Math.min(100, Math.round((today.reviewed / goal) * 100))}%`;
    el("dailyDoneNum").textContent = today.reviewed;
    el("dailyGoalNum").textContent = goal;
    el("todayAccuracy").textContent = today.reviewed ? `${Math.round((today.correct / today.reviewed) * 100)} %` : "–";
    el("dailyGoal").value = goal;
    el("dailyGoalDisplay").textContent = goal;

    const startBtn = el("startSessionBtn");
    const moreWordsWaiting = allFreshCards().length > fresh;
    const keepLearningBtn = el("keepLearningBtn");
    if (due + fresh === 0) {
      startBtn.disabled = true;
      startBtn.textContent = "Für heute erledigt";
      el("sessionHint").textContent = moreWordsWaiting
        ? "Das Tageslimit für neue Wörter ist erreicht."
        : "Morgen gibt es neue Wiederholungen.";
      keepLearningBtn.hidden = !moreWordsWaiting;
    } else {
      startBtn.disabled = false;
      startBtn.textContent = today.reviewed ? "Weiterlernen" : "Sitzung starten";
      el("sessionHint").textContent = `${due} fällig · ${fresh} neu`;
      keepLearningBtn.hidden = true;
    }
    renderToday();
  }

  // "Außerdem heute": the lesson, new exercise sets, grammar with recent mistakes.
  function todayList() {
    return TODAY.items({
      lesson: LESSON.current(), packs, events,
      grammarCards: state.grammarCards, grammarItems: GRAMMAR.ITEMS, grammarLabels: GRAMMAR.CATEGORY_LABELS,
    });
  }
  const TODAY_ICONS = { lesson: "headphones", pack: "coach", grammar: "grammar" };
  function todayRow(it) {
    return `<button class="list-row" data-today="${it.kind}" data-id="${esc(it.id || "")}">
      <span class="row-icon">${icon(TODAY_ICONS[it.kind])}</span>
      <span class="grow"><span class="title">${esc(it.title)}</span><span class="meta">${esc(it.meta)}</span></span>
      ${it.done ? icon("check", "icon chev ok") : icon("chev", "icon chev")}</button>`;
  }
  function renderToday() {
    const list = todayList();
    el("todayList").hidden = !list.length;
    el("todayEmpty").hidden = list.length > 0;
    el("todayList").innerHTML = list.map(todayRow).join("");
  }
  function openTodayItem(kind, id) {
    if (kind === "lesson") showView("lesson");
    else if (kind === "pack") { const p = packs.find((x) => x.id === id); if (p) startPack(p); }
    else if (kind === "grammar") startGrammar([id]);
  }
  document.addEventListener("click", (e) => {
    const row = e.target.closest("[data-today]");
    if (row) openTodayItem(row.dataset.today, row.dataset.id);
  });

  // ---------- Üben ----------
  function renderPractice() {
    const due = cardsDueNow().length;
    const fresh = cardsNewAvailable().length;
    el("practiceVocabMeta").textContent = due + fresh ? `${due} fällig · ${fresh} neu` : "Für heute erledigt";
    el("practiceConjMeta").textContent = conjSelectedTenses.size
      ? [...conjSelectedTenses].map((t) => CONJUGATE.TENSE_LABELS[t]).join(", ")
      : `${CONJUGATE.ALL_VERBS.length} Verben`;
    el("practiceGrammarMeta").textContent = `${GRAMMAR.CATEGORIES.length} Themen`;
    el("totalCount").textContent = DECK.length;

    const practised = new Set(events.filter((e) => e.kind === "pack").map((e) => e.packId));
    const newest = packs.slice().sort((a, b) => b.addedAt - a.addedAt).slice(0, 3);
    el("practicePacks").innerHTML = newest.map((p) => `<button class="list-row" data-pack-start="${esc(p.id)}">
        <span class="row-icon">${icon("coach")}</span>
        <span class="grow"><span class="title">${esc(p.title)}</span><span class="meta">${p.items.length} Aufgaben${practised.has(p.id) ? "" : " · neu"}</span></span>
        ${practised.has(p.id) ? "" : '<span class="dot" aria-label="neu"></span>'}${icon("chev", "icon chev")}</button>`).join("") +
      `<button class="list-row" data-open="packs"><span class="row-icon">${icon("target")}</span>
        <span class="grow"><span class="title">${packs.length ? "Alle Übungssätze" : "Übungssätze"}</span>
        <span class="meta">${packs.length ? `${packs.length} insgesamt · Datei importieren` : "Noch keine – lass sie im Coach erstellen"}</span></span>${icon("chev", "icon chev")}</button>`;
  }
  el("view-practice").addEventListener("click", (e) => {
    const start = e.target.closest("[data-pack-start]");
    if (start) { const p = packs.find((x) => x.id === start.dataset.packStart); if (p) startPack(p); return; }
    const row = e.target.closest("[data-open]");
    if (!row) return;
    if (row.dataset.open === "vocab") {
      if (!startSession()) showView("home");
    } else showView(row.dataset.open);
  });

  el("keepLearningBtn").addEventListener("click", () => {
    state.newCapOverrideDay = todayKey();
    save();
    renderHome();
  });

  el("dailyGoal").addEventListener("input", (e) => {
    state.dailyGoal = Number(e.target.value);
    el("dailyGoalDisplay").textContent = state.dailyGoal;
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
    const c = cards[deckItem.term];
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
    if (!queue.length) return false;
    session = { queue, idx: 0, reviewed: 0, correct: 0, missed: new Set() };
    touchStreak();
    showView("session");
    renderCurrentCard();
    return true;
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
    const promptLang = dir === "es-de" ? COURSE.lang : "de";
    const answerLang = dir === "es-de" ? "de" : COURSE.lang;
    el("flipFront").lang = promptLang;
    el("flipBack").lang = answerLang;
    el("flipFront").textContent = promptWord(d, dir);
    el("flipBack").textContent = answerPrimary(d, dir);
    el("flipEx").textContent = d.ex || "";
    el("flipExDe").textContent = d.exDe || "";
    el("gradeRow").classList.add("hidden-until-flip");
    el("cardSpeak").dataset.say = d.term;
    updateCardSpeaker();

    void flashcardInner.offsetWidth; // force a reflow before re-enabling the transition
    flashcardInner.style.transition = "";

    const c = ensureCard(d.term);
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
    updateCardSpeaker();
  }
  /* Going German -> course language, saying the word would give the answer
     away: the speaker appears only once the card is turned. */
  function updateCardSpeaker() {
    const b = el("cardSpeak");
    b.dataset.sayHidden = state.direction === "de-es" && !flipped ? "1" : "";
    b.hidden = b.dataset.sayHidden === "1" || !SPEECH.available();
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
    el("mcPrompt").lang = dir === "es-de" ? COURSE.lang : "de";
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
    let options = collect(DECK.filter((x) => x.term !== d.term && x.pos === d.pos), []);
    if (options.length < 3) collect(DECK.filter((x) => x.term !== d.term), options);
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
      if (dir === "de-es") b.lang = COURSE.lang;
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
    el("typePrompt").lang = dir === "es-de" ? COURSE.lang : "de";
    el("typePrompt").textContent = promptWord(d, dir);
    const input = el("typeInput");
    input.value = "";
    input.className = "type-input";
    input.disabled = false;
    input.placeholder = dir === "es-de" ? "Deutsche Übersetzung eintippen …" : `Übersetzung ${COURSE.inDe} eintippen …`;
    input.lang = dir === "es-de" ? "de" : COURSE.lang;
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
  function promptWord(d, dir) { return dir === "es-de" ? d.term : germanPrimary(d.de); }
  function answerPrimary(d, dir) { return dir === "es-de" ? germanPrimary(d.de) : d.term; }
  function promptFlag(dir) { return dir === "es-de" ? COURSE.flag : "🇩🇪"; }

  /* Several course words share the same primary German meaning
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
      ? TEXT.meanings(d.de)
      : germanGroup(d).map((x) => norm(x.term));
  }

  const judgeAnswer = (typed, alternatives) => TEXT.judge(typed, alternatives);

  let lastTyped = null;   // last input, for the log

  function gradeCurrent(grade, correct) {
    const item = currentItem();
    const c = ensureCard(item.deck.term);
    if (c.state === "new") {
      const k = todayKey();
      state.newIntroducedOn[k] = (state.newIntroducedOn[k] || 0) + 1;
    }
    cards[item.deck.term] = SRS.review(c, grade, { desiredRetention: 0.9, mode: item.mode });
    session.reviewed += 1;
    if (correct) session.correct += 1;
    else session.missed.add(item.deck.term);
    logReview(correct);
    logEvent({
      kind: "vocab", id: item.deck.term, dir: state.direction, mode: item.mode,
      grade, ok: correct, typed: lastTyped, expected: answerPrimary(item.deck, state.direction),
    });
    lastTyped = null;
    save(item.deck.term);

    // "Again" -> mix the card back in later in the same session
    if (grade === 1 && !item.requeued) {
      const reinsertAt = Math.min(session.queue.length, session.idx + 3 + Math.floor(Math.random() * 3));
      session.queue.splice(reinsertAt, 0, { deck: item.deck, mode: "flip", requeued: true });
    }

    session.idx += 1;
    renderCurrentCard();
  }

  /**
   * The end of any session: the numbers, what went wrong, and one suggestion
   * for what to do next from the Heute list.
   */
  let doneNext = null;
  function showDone({ reviewed, correct, label, withStreak, missed, back, finished }) {
    el("doneTitle").textContent = reviewed && correct === reviewed ? "Alles richtig" : "Geschafft";
    el("doneReviewedLabel").textContent = label;
    el("doneReviewed").textContent = reviewed;
    el("doneAccuracy").textContent = reviewed ? `${Math.round((correct / reviewed) * 100)} %` : "–";
    el("doneStreak").textContent = state.streak;
    el("doneStreakBlock").hidden = !withStreak;
    el("doneMissedBlock").hidden = !missed.length;
    el("doneMissed").innerHTML = missed.slice(0, 12).map((m) => `<${m.term ? `button class="list-row" data-word="${esc(m.term)}"` : 'div class="list-row"'}>
        <span class="grow"><span class="title" lang="${COURSE.lang}">${m.html || esc(m.title)}</span>${m.meta ? `<span class="meta">${esc(m.meta)}</span>` : ""}</span>
        ${m.term ? icon("chev", "icon chev") : ""}</${m.term ? "button" : "div"}>`).join("");

    const due = cardsDueNow().length + cardsNewAvailable().length;
    doneNext = finished.kind !== "vocab" && due ? { kind: "vocab", title: "Vokabeln" } : TODAY.nextStep(todayList(), finished);
    const next = el("doneNextBtn");
    next.hidden = !doneNext;
    if (doneNext) next.textContent = `Als Nächstes: ${doneNext.title}`;
    el("doneContinueBtn").textContent = doneNext ? "Fertig" : "Weiter";
    doneReturnView = back;
    syncFolder();
    showView("done");
  }
  el("doneNextBtn").addEventListener("click", () => {
    if (!doneNext) return;
    if (doneNext.kind === "vocab") { if (!startSession()) showView("home"); }
    else openTodayItem(doneNext.kind, doneNext.id);
  });

  function finishSession() {
    const s = session || { reviewed: 0, correct: 0, missed: new Set() };
    el("sessionContinueBtn").hidden = true;
    session = null;
    const byTerm = new Map(DECK.map((d) => [d.term, d]));
    showDone({
      reviewed: s.reviewed, correct: s.correct, label: "Karten geübt", withStreak: true, back: "home",
      finished: { kind: "vocab" },
      missed: [...s.missed].map((t) => byTerm.get(t)).filter(Boolean)
        .map((d) => ({ term: d.term, title: d.term, meta: d.de.replace(/\|/g, ", ") })),
    });
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
    conjSession = { queue, idx: 0, reviewed: 0, correct: 0, missed: [] };
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
    // A course may accept more than one spelling (English: "have gone" / "'ve gone").
    const accepted = CONJUGATE.alternatives ? CONJUGATE.alternatives(correctForm) : [correctForm];
    const ok = accepted.some((form) => norm(input.value) === norm(form));
    input.className = "type-input " + (ok ? "correct" : "wrong");
    const fb = el("conjFeedback");
    fb.className = "type-feedback " + (ok ? "correct" : "wrong");
    fb.textContent = ok ? COURSE.praise : `Richtig wäre: ${correctForm}`;
    input.disabled = true;
    el("conjCheckBtn").disabled = true;
    el("conjCheckBtn").hidden = true;
    logConjAttempt(item, ok, correctForm, input.value);
    conjSession.reviewed += 1;
    if (ok) conjSession.correct += 1;
    else conjSession.missed.push({ title: correctForm, meta: `${verb.infinitive} · ${CONJUGATE.TENSE_LABELS[item.tense]} · ${CONJUGATE.PERSON_LABELS[item.person]}` });
    el("conjScore").textContent = `${conjSession.correct} / ${conjSession.reviewed} richtig`;
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
    const s = conjSession || { reviewed: 0, correct: 0, missed: [] };
    el("conjContinueBtn").hidden = true;
    conjSession = null;
    showDone({ reviewed: s.reviewed, correct: s.correct, label: "Formen geübt", withStreak: false,
      missed: s.missed, back: "conj", finished: { kind: "conj" } });
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

  function buildGrammarQueue(categories) {
    const items = [];
    categories.forEach((c) => items.push(...GRAMMAR.itemsForCategory(c)));
    return items
      .map((it) => ({ it, score: practiceScore(state.grammarCards[it.id]) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 40)
      .map((x) => x.it);
  }

  /** A grammar session over these categories (the chosen ones, or one topic from Heute). */
  function startGrammar(categories) {
    const queue = shuffle(buildGrammarQueue(categories));
    if (!queue.length) return;
    grammarSession = { queue, idx: 0, reviewed: 0, correct: 0, missed: [], categories };
    touchStreak();
    showView("grammarsession");
    renderGrammarItem();
  }
  el("startGrammarBtn").addEventListener("click", () => startGrammar([...grammarSelectedCategories]));
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
    el("grammarVerdict").hidden = true;
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
        el("grammarVerdict").hidden = false;
        el("grammarVerdict").className = "verdict " + (ok ? "correct" : "wrong");
        el("grammarVerdict").textContent = ok ? "Richtig" : `Nicht ganz – richtig ist „${item.answer}“`;
        logGrammarAttempt(item, ok, opt);
        grammarSession.reviewed += 1;
        if (ok) grammarSession.correct += 1;
        else grammarSession.missed.push({ html: fillGap(item.prompt, item.answer), meta: GRAMMAR.CATEGORY_LABELS[item.category] });
        el("grammarScore").textContent = `${grammarSession.correct} / ${grammarSession.reviewed} richtig`;
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
    const s = grammarSession || { reviewed: 0, correct: 0, missed: [], categories: [] };
    el("grammarContinueBtn").hidden = true;
    grammarSession = null;
    showDone({ reviewed: s.reviewed, correct: s.correct, label: "Fragen beantwortet", withStreak: false,
      missed: s.missed, back: "grammar",
      finished: { kind: "grammar", id: s.categories.length === 1 ? s.categories[0] : null } });
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
        b.lang = item.lang || COURSE.lang;
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
      input.lang = item.type === "translate" ? (item.to || COURSE.lang) : (item.lang || COURSE.lang);
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
    el("packPrompt").lang = item.type === "translate" ? (item.from || "de") : (item.lang || COURSE.lang);
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
    if (!ok) (packSession.missed || (packSession.missed = [])).push({ title: solution, meta: item.prompt });
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
    const s = packSession;
    el("packContinueBtn").hidden = true;
    packSession = null;
    showDone({ reviewed: s ? s.reviewed : 0, correct: s ? s.correct : 0, label: "Aufgaben gelöst", withStreak: false,
      missed: (s && s.missed) || [], back: "packs", finished: { kind: "pack", id: s && s.meta.packId } });
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
      msg.innerHTML = "Noch keine Übungen. Lass sie im Bereich „Coach“ erstellen — " +
        "sie erscheinen hier von selbst. Alternativ eine JSON-Datei importieren.";
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
  function stateClass(c) {
    if (!c || c.state === "new") return "";
    if (c.state === "learning" || c.state === "relearning") return "learning";
    if (c.stability >= 21) return "mature";
    return "young";
  }
  const STATE_LABELS = { "": "neu", learning: "am Lernen", young: "jung", mature: "gefestigt" };
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
      if (q && !(d.term.toLowerCase().includes(q) || d.de.toLowerCase().includes(q))) return false;
      return true;
    });
    if (!filtered.length) {
      list.innerHTML = `<div class="empty-state">Keine Vokabeln gefunden.</div>`;
      return;
    }
    list.innerHTML = filtered.map((d) => {
      const c = cards[d.term];
      return `<div class="browse-item">
        <button class="bi-open" data-word="${esc(d.term)}">
          <span class="bi-state ${stateClass(c)}" title="${STATE_LABELS[stateClass(c)]}"></span>
          <span class="bi-main"><span class="bi-es" lang="${COURSE.lang}">${esc(d.term)}</span><span class="bi-de">${esc(d.de.replace(/\|/g, ", "))}</span></span>
          <span class="bi-level">${esc(d.level)}</span>
        </button>
        <button class="icon-btn speak-btn" data-say="${esc(d.term)}" aria-label="${esc(d.term)} aussprechen" hidden>${icon("speaker", "icon sm")}</button>
      </div>`;
    }).join("");
    SPEECH.updateButtons(list);
  }
  /* The search reacts to typing only. A "change" on it fires when it loses
     focus - that is, in the middle of tapping a result - and redrawing the
     list then would swallow the tap. */
  el("browseSearch").addEventListener("input", renderBrowse);
  ["browseTopic", "browseLevel"].forEach((id) => el(id).addEventListener("change", renderBrowse));

  // ---------- Stats ----------
  function renderStats() {
    el("statsSub").textContent = `${learnedCount()} von ${DECK.length} Wörtern begonnen`;
    const totalReviews = Object.values(state.log).reduce((s, d) => s + d.reviewed, 0);
    el("statTotalReviews").textContent = totalReviews;

    const last30 = last30Keys();
    let rev = 0, cor = 0;
    last30.forEach((k) => { const d = state.log[k]; if (d) { rev += d.reviewed; cor += d.correct; } });
    el("statAccuracy").textContent = rev ? `${Math.round((cor / rev) * 100)}%` : "–";
    el("statStreak").textContent = state.streak;
    el("statMature").textContent = matureCount();

    renderCalendar();
    const week = INSIGHTS.weekSummary(events);
    el("weekSummary").innerHTML = `
      <div><strong>${week.answers}</strong><span>Antworten diese Woche</span></div>
      <div><strong>${week.accuracy == null ? "–" : `${week.accuracy} %`}</strong><span>richtig</span></div>
      <div><strong>${week.days} / 7</strong><span>Tage geübt</span></div>`;
    const hardest = INSIGHTS.hardestWords({ events, cards, deck: DECK });
    el("hardestBlock").hidden = !hardest.length;
    el("hardestList").innerHTML = hardest.map((w) => `<button class="list-row" data-word="${esc(w.term)}">
        <span class="grow"><span class="title" lang="${COURSE.lang}">${esc(w.term)}</span><span class="meta">${esc(w.de)}</span></span>
        <span class="count">${w.wrong}× falsch</span>${icon("chev", "icon chev")}</button>`).join("");

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
    const colors = { neu: "var(--surface-3)", lernend: "var(--warn)", jung: "var(--blue)", reif: "var(--good)" };
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

  // The month shown in the calendar; arrows step through earlier months.
  let calMonth = null;
  const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  function renderCalendar() {
    const now = new Date();
    if (!calMonth) calMonth = { y: now.getFullYear(), m: now.getMonth() };
    const weeks = INSIGHTS.calendar(events, calMonth.y, calMonth.m);
    el("calTitle").textContent = `${MONTHS[calMonth.m]} ${calMonth.y}`;
    el("calNext").disabled = calMonth.y === now.getFullYear() && calMonth.m === now.getMonth();
    const head = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((d) => `<span class="cal-dow">${d}</span>`).join("");
    el("calendar").innerHTML = head + weeks.flat().map((c) => {
      if (!c) return '<span class="cal-day empty"></span>';
      const label = `${c.day}. ${MONTHS[calMonth.m]}: ${c.answers ? `${c.answers} ${c.answers === 1 ? "Antwort" : "Antworten"}` : "nicht geübt"}`;
      return `<span class="cal-day l${c.level}${c.today ? " today" : ""}${c.future ? " future" : ""}" title="${label}" aria-label="${label}" role="img"></span>`;
    }).join("");
  }
  el("calPrev").addEventListener("click", () => {
    calMonth = calMonth.m === 0 ? { y: calMonth.y - 1, m: 11 } : { y: calMonth.y, m: calMonth.m - 1 };
    renderCalendar();
  });
  el("calNext").addEventListener("click", () => {
    calMonth = calMonth.m === 11 ? { y: calMonth.y + 1, m: 0 } : { y: calMonth.y, m: calMonth.m + 1 };
    renderCalendar();
  });

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
    el("conjStatsBlock").hidden = totalConjReviews === 0;   // only once there is something to show

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
            <span class="conj-log-main"><strong lang="${COURSE.lang}">${esc(m.form)}</strong> <span class="conj-log-dim">(${esc(m.infinitive)}, ${CONJUGATE.TENSE_LABELS[m.tense]}, ${personShort(m.person)})</span></span>
            <span class="conj-log-count">${m.wrongCount}×</span>
          </div>`).join("")
      : `<div class="conj-log-empty">Bisher keine wiederholten Fehler — gut gemacht!</div>`;

    el("conjRecentList").innerHTML = recentConj.map((r) => {
      const icon = r.ok ? `<span class="conj-log-icon correct">✓</span>` : `<span class="conj-log-icon wrong">✗</span>`;
      const meta = `${esc(r.verb)}, ${CONJUGATE.TENSE_LABELS[r.tense] || "?"}, ${personShort(r.person)}`;
      const detail = r.ok
        ? `<strong lang="${COURSE.lang}">${esc(r.expected)}</strong> <span class="conj-log-dim">(${meta})</span>`
        : `<strong lang="${COURSE.lang}">${esc(r.expected)}</strong> <span class="conj-log-dim">(${meta}) — du: „${esc(r.typed || "–")}“</span>`;
      return `<div class="conj-log-row">${icon}<span class="conj-log-main">${detail}</span><span class="conj-log-time">${timeAgo(r.t)}</span></div>`;
    }).join("");
  }
  /** "Yo ___ profesor." + "soy" -> escaped text with the solution highlighted. */
  /* Puts the answer into the gap. An answer like "are … wearing" fills two
     gaps ("Why ___ you ___ a coat?") one part each. */
  function fillGap(prompt, answer) {
    const pieces = String(prompt).split("___");
    if (pieces.length === 1) return esc(prompt);
    const parts = String(answer).split(" … ");
    if (parts.length === pieces.length - 1) {
      return pieces.map((p, i) => esc(p) + (i < parts.length ? `<strong>${esc(parts[i])}</strong>` : "")).join("");
    }
    const [before, ...rest] = pieces;
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
    el("grammarStatsBlock").hidden = totalReviews === 0;

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
            <span class="conj-log-main" lang="${COURSE.lang}">${fillGap(item.prompt, item.answer)} <span class="conj-log-dim" lang="de">(${GRAMMAR.CATEGORY_LABELS[item.category]})</span></span>
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

  /* The report as files, for anyone who wants to read it or hand it to a
     model outside the app. Separate downloads instead of an archive - that
     saves a library, and the browser asks once. */
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
    status.textContent = "Dein Lernstand wird auf dem Server gespeichert. Hier kannst du ihn herunterladen – " +
      "den Fortschritt als Datei oder den Lernbericht, aus dem der Coach seine Übungen baut.";
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

  /** Heute lists the lesson; refresh it when the lesson changes. */
  function markiereLektion() {
    if (currentView === "home") renderToday();
  }

  // ---------- Exercise sets from the coach ----------
  async function loadPacksFromFolder() {
    packs = await STORE.allPacks();
    packLoadErrors = [];
    renderPacks();
    return { count: packs.length, errors: [] };
  }

  // ---------- Welcome (first start in a course) ----------
  /* Four steps: the language, the idea, the daily goal, the four sections.
     Picking the other language switches the course and reloads into it;
     the welcome then carries on there with step 2. */
  const WELCOME_STEPS = 4;
  const WELCOME_RESUME = "voco:welcome-step";
  let welcomeStep = 1;
  let welcomeCourse = null;

  function markChoices(container, attr, value) {
    container.querySelectorAll(".choice").forEach((c) => {
      const on = c.dataset[attr] === String(value);
      c.classList.toggle("on", on);
      c.setAttribute("aria-checked", on ? "true" : "false");
    });
  }
  async function renderWelcomeCourses() {
    const box = el("welcomeCourses");
    if (!box.children.length) {
      // The courses come from the server - no language list in shared code.
      const { courses = [] } = await STORE.call("GET", "auth/config");
      box.innerHTML = courses.map((c) =>
        `<button class="choice" role="radio" data-course="${esc(c.id)}"><span>${esc(c.name)}</span></button>`).join("");
    }
    markChoices(box, "course", welcomeCourse);
  }
  function showWelcomeStep(n) {
    welcomeStep = n;
    document.querySelectorAll(".welcome-step").forEach((s) => { s.hidden = Number(s.dataset.step) !== n; });
    document.querySelectorAll(".welcome .dots i").forEach((d) => d.classList.toggle("on", Number(d.dataset.dot) === n));
    markChoices(el("welcomeGoals"), "goal", state.dailyGoal);
    if (n === 1) renderWelcomeCourses().catch(() => showWelcomeStep(2));
    el("welcomeNext").textContent = n === WELCOME_STEPS ? "Los geht's" : "Weiter";
  }
  async function welcomeNext() {
    if (welcomeStep === 1 && welcomeCourse !== COURSE.id) {
      try {
        await STORE.call("PUT", "auth/course", { course: welcomeCourse });
        try { sessionStorage.setItem(WELCOME_RESUME, "2"); sessionStorage.removeItem("voco:position"); } catch (e) { /* egal */ }
        location.reload();
        return;
      } catch (e) {
        alert("Kurswechsel fehlgeschlagen: " + e.message);
        return;
      }
    }
    if (welcomeStep < WELCOME_STEPS) showWelcomeStep(welcomeStep + 1);
    else finishWelcome();
  }
  function startWelcome() {
    welcomeCourse = COURSE.id;
    let resume = 1;
    try { resume = Number(sessionStorage.getItem(WELCOME_RESUME)) || 1; sessionStorage.removeItem(WELCOME_RESUME); } catch (e) { /* egal */ }
    showView("welcome");
    showWelcomeStep(resume);
  }
  el("welcomeCourses").addEventListener("click", (e) => {
    const c = e.target.closest(".choice");
    if (!c) return;
    welcomeCourse = c.dataset.course;
    markChoices(el("welcomeCourses"), "course", welcomeCourse);
  });
  function finishWelcome() {
    state.welcomeSeen = true;
    save();
    showView("home");
  }
  el("welcomeGoals").addEventListener("click", (e) => {
    const c = e.target.closest(".choice");
    if (!c) return;
    state.dailyGoal = Number(c.dataset.goal);
    markChoices(el("welcomeGoals"), "goal", state.dailyGoal);
  });
  el("welcomeNext").addEventListener("click", welcomeNext);
  el("welcomeSkip").addEventListener("click", finishWelcome);

  // ---------- Startup ----------
  async function boot() {
    await STORE.init();
    state = await STORE.loadState();
    cards = await STORE.loadCards();
    events = await STORE.allEvents();
    packs = await STORE.allPacks();

    if (!state.grammarCategories) state.grammarCategories = [...GRAMMAR.CATEGORIES];
    // Categories added to the course since the learner's last visit start selected;
    // ones they switched off themselves stay off.
    const knownCategories = state.grammarKnownCategories || state.grammarCategories;
    GRAMMAR.CATEGORIES.filter((c) => !knownCategories.includes(c) && !state.grammarCategories.includes(c))
      .forEach((c) => state.grammarCategories.push(c));
    state.grammarKnownCategories = [...GRAMMAR.CATEGORIES];
    conjSelectedTenses = new Set(state.conjTenses);
    conjVerbSet = state.conjVerbSet;
    grammarSelectedCategories = new Set(state.grammarCategories);

    renderHome();
    renderPacks();
    renderSyncStatus();
    await LESSON.load();
    markiereLektion();

    // When the coach creates an exercise or lesson, it shows up on its own.
    STORE.onExercisesChanged(async () => {
      packs = await STORE.allPacks();
      if (currentView === "packs") renderPacks();
      if (currentView === "practice") renderPractice();
      if (currentView === "home") renderToday();
      if (!["packs", "practice"].includes(currentView)) el("tab-practice").classList.add("tab-alert");
    });
    STORE.onLessonsChanged(async () => {
      await LESSON.load();
      if (!["lesson", "home"].includes(currentView)) el("tab-home").classList.add("tab-alert");
      markiereLektion();
    });
    LESSON.setOnSubmitted(markiereLektion);
    COACH.init({
      isVisible: () => currentView === "coach",
      alert: () => el("tab-coach").classList.add("tab-alert"),
      openSettings: () => { go("settings"); requestAnimationFrame(() => el("settingsCoach").scrollIntoView({ block: "start" })); },
    });

    WORDSHEET.init({ cards: () => cards, events: () => events });

    stellePositionHer();
    // Learners with answers in this course never see the welcome.
    if (!state.welcomeSeen && !events.length) startWelcome();
    document.body.dataset.ready = "1";   // for the browser tests: handlers are attached
  }

  boot().catch((e) => {
    const box = el("bootError");
    box.hidden = false;
    box.textContent = "Keine Verbindung zum Server: " + e.message;
    console.error("Start fehlgeschlagen", e);
  });
})();
