/* Vokabeltrainer – App-Logik */
(function () {
  "use strict";

  const STORAGE_KEY = "voco.es.v1";
  const DAY = SRS.DAY;
  const todayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

  // ---------- State laden/speichern ----------
  function loadState() {
    let raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { /* privater Modus etc. */ }
    if (raw) {
      try { return migrate(JSON.parse(raw)); } catch (e) { /* fällt durch auf Default */ }
    }
    return {
      cards: {},              // id -> SRS-Karte
      dailyGoal: 20,
      log: {},                 // "YYYY-MM-DD" -> { reviewed, correct }
      newIntroducedOn: {},     // "YYYY-MM-DD" -> count neuer Karten eingeführt
      lastActiveDay: null,
      streak: 0,
      direction: "es-de",      // "es-de" oder "de-es"
      newCapOverrideDay: null,  // "YYYY-MM-DD" -> Tageslimit für neue Karten an diesem Tag aufgehoben
      conjCards: {},           // "infinitiv|zeit|person" -> { attempts, correct, wrongCount, lastResult, lastAt }
      conjLog: {},              // "YYYY-MM-DD" -> { reviewed, correct }
      conjRecent: [],           // letzte Konjugationsversuche, neueste zuerst
      grammarCards: {},        // Item-ID -> { attempts, correct, wrongCount, lastResult, lastAt }
      grammarLog: {},           // "YYYY-MM-DD" -> { reviewed, correct }
      grammarRecent: [],        // letzte Grammatikversuche, neueste zuerst
    };
  }
  function migrate(s) {
    s.cards = s.cards || {};
    s.log = s.log || {};
    s.newIntroducedOn = s.newIntroducedOn || {};
    s.dailyGoal = s.dailyGoal || 20;
    s.streak = s.streak || 0;
    s.direction = s.direction || "es-de";
    s.newCapOverrideDay = s.newCapOverrideDay || null;
    s.conjCards = s.conjCards || {};
    s.conjLog = s.conjLog || {};
    s.conjRecent = s.conjRecent || [];
    s.grammarCards = s.grammarCards || {};
    s.grammarLog = s.grammarLog || {};
    s.grammarRecent = s.grammarRecent || [];
    return s;
  }
  let state = loadState();
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* Speicher voll o.ä. */ }
      writeSyncFile();
    }, 150);
  }

  // ---------- Automatische Dateisynchronisierung (File System Access API) ----------
  let syncFileHandle = null;
  function exportPayload() {
    return { exportedAt: new Date().toISOString(), deckVersion: DECK.length, state };
  }
  async function writeSyncFile() {
    if (!syncFileHandle) return;
    try {
      if ((await syncFileHandle.queryPermission({ mode: "readwrite" })) !== "granted") return;
      const writable = await syncFileHandle.createWritable();
      await writable.write(JSON.stringify(exportPayload(), null, 2));
      await writable.close();
    } catch (e) { /* Handle verloren, Berechtigung entzogen o.ä. – stillschweigend überspringen */ }
  }

  function ensureCard(id) {
    if (!state.cards[id]) state.cards[id] = SRS.newCard(id);
    return state.cards[id];
  }

  function cardsDueNow(now = Date.now()) {
    return DECK.filter((d) => {
      const c = state.cards[d.es];
      return c && c.state !== "new" && c.due <= now;
    });
  }
  function allFreshCards() {
    return DECK.filter((d) => !state.cards[d.es] || state.cards[d.es].state === "new");
  }
  // Tageslimit für neue Karten entspricht dem Tagesziel, kann aber per Klick aufgehoben werden.
  function cardsNewAvailable() {
    const fresh = allFreshCards();
    if (state.newCapOverrideDay === todayKey()) return fresh;
    const introducedToday = state.newIntroducedOn[todayKey()] || 0;
    const remainingCap = Math.max(0, state.dailyGoal - introducedToday);
    return fresh.slice(0, remainingCap);
  }
  function learnedCount() {
    return Object.values(state.cards).filter((c) => c.state !== "new").length;
  }
  function matureCount() {
    return Object.values(state.cards).filter((c) => c.state === "review" && c.stability >= 21).length;
  }

  // ---------- Streak ----------
  function touchStreak() {
    const today = todayKey();
    if (state.lastActiveDay === today) return;
    if (state.lastActiveDay) {
      const gapDays = Math.round((new Date(today) - new Date(state.lastActiveDay)) / DAY);
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

  function showView(name) {
    Object.entries(views).forEach(([k, el]) => el.classList.toggle("active", k === name));
    tabs.forEach((t) => t.classList.toggle("active", t.dataset.view === name));
    if (name === "browse") renderBrowse();
    if (name === "stats") { renderStats(); renderSyncStatus(); }
    if (name === "home") renderHome();
    if (name === "conj") renderConjOverview();
    if (name === "grammar") renderGrammarOverview();
  }
  tabs.forEach((t) => t.addEventListener("click", () => showView(t.dataset.view)));

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
    // Fällige zuerst, dann neue eingestreut; Reihenfolge gemischt für Abwechslung
    const items = shuffle([...due]).concat(shuffle([...fresh]));
    return items.slice(0, 60).map((d) => ({ deck: d, mode: pickMode(d) }));
  }

  function pickMode(deckItem) {
    const c = state.cards[deckItem.es];
    if (!c || c.state === "new") return "flip";           // Neues immer erst als Karteikarte
    const strength = SRS.strength(c);
    if (strength < 0.35) return Math.random() < 0.5 ? "flip" : "mc";
    if (strength < 0.7) return Math.random() < 0.5 ? "mc" : "type";
    return "type";                                          // gut gefestigt -> aktiver Abruf
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
  el("exitSessionBtn").addEventListener("click", () => { session = null; showView("home"); });

  let doneReturnView = "home";
  el("doneContinueBtn").addEventListener("click", () => showView(doneReturnView));

  function currentItem() { return session.queue[session.idx]; }

  function renderCurrentCard() {
    if (!session || session.idx >= session.queue.length) return finishSession();
    const item = currentItem();
    const d = item.deck;
    el("sessionIdx").textContent = session.idx + 1;
    el("sessionTotal").textContent = session.queue.length;
    el("sessionProgressBar").style.width = `${(session.idx / session.queue.length) * 100}%`;

    ["flip", "mc", "type"].forEach((m) => el(`mode-${m}`).hidden = m !== item.mode);
    el("sessionContinueBtn").hidden = true;

    if (item.mode === "flip") renderFlip(d);
    else if (item.mode === "mc") renderMC(d);
    else renderType(d);
  }

  // --- Karteikarte ---
  const flashcardEl = el("flashcard");
  const flashcardInner = el("flashcardInner");
  let flipped = false;

  function renderFlip(d) {
    // Transition kurz abschalten, damit das Zurückklappen der vorigen Karte
    // nicht animiert wird und dabei die neue Antwort schon durchscheint.
    flashcardInner.style.transition = "none";
    flipped = false;
    flashcardEl.classList.remove("flipped");

    const dir = state.direction;
    el("flipPos").textContent = `${promptFlag(dir)} ${posLabel(d.pos)}`;
    el("flipFront").textContent = promptWord(d, dir);
    el("flipBack").textContent = answerPrimary(d, dir);
    el("flipEx").textContent = d.ex || "";
    el("flipExDe").textContent = d.exDe || "";
    el("gradeRow").classList.add("hidden-until-flip");

    void flashcardInner.offsetWidth; // Reflow erzwingen, bevor die Transition wieder aktiviert wird
    flashcardInner.style.transition = "";

    const c = ensureCard(d.es);
    const preview = SRS.previewIntervals(c, { desiredRetention: 0.9, now: Date.now() });
    el("iv1").textContent = preview[1];
    el("iv2").textContent = preview[2];
    el("iv3").textContent = preview[3];
    el("iv4").textContent = preview[4];
  }
  flashcardEl.addEventListener("click", () => {
    flipped = !flipped;
    flashcardEl.classList.toggle("flipped", flipped);
    el("gradeRow").classList.toggle("hidden-until-flip", !flipped);
  });
  document.querySelectorAll(".grade-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!flipped) return;
      const grade = Number(btn.dataset.grade);
      gradeCurrent(grade, grade >= 3);
    });
  });

  // --- Multiple Choice ---
  function renderMC(d) {
    const dir = state.direction;
    el("mcPos").textContent = `${promptFlag(dir)} ${posLabel(d.pos)}`;
    el("mcPrompt").textContent = promptWord(d, dir);
    const correct = answerPrimary(d, dir);
    const distractors = shuffle(
      DECK.filter((x) => x.es !== d.es && x.pos === d.pos).map((x) => answerPrimary(x, dir))
    );
    let options = distractors.slice(0, 3);
    if (options.length < 3) {
      const more = shuffle(DECK.filter((x) => x.es !== d.es).map((x) => answerPrimary(x, dir)))
        .filter((o) => !options.includes(o) && o !== correct);
      options = options.concat(more.slice(0, 3 - options.length));
    }
    options.push(correct);
    options = shuffle([...new Set(options)]);

    const grid = el("mcGrid");
    grid.innerHTML = "";
    options.forEach((opt) => {
      const b = document.createElement("button");
      b.className = "mc-option";
      b.textContent = opt;
      b.addEventListener("click", () => {
        const ok = opt === correct;
        grid.querySelectorAll(".mc-option").forEach((o) => {
          o.classList.add("disabled");
          if (o.textContent === correct) o.classList.add("correct");
          else if (o === b && !ok) o.classList.add("wrong");
        });
        const continueBtn = el("sessionContinueBtn");
        continueBtn.hidden = false;
        continueBtn.onclick = () => gradeCurrent(ok ? 3 : 1, ok);
      });
      grid.appendChild(b);
    });
  }

  // --- Tippen ---
  function renderType(d) {
    const dir = state.direction;
    el("typePos").textContent = `${promptFlag(dir)} ${posLabel(d.pos)}`;
    el("typePrompt").textContent = promptWord(d, dir);
    const input = el("typeInput");
    input.value = "";
    input.className = "type-input";
    input.disabled = false;
    input.placeholder = dir === "es-de" ? "Deutsche Übersetzung eintippen …" : "Übersetzung auf Spanisch eintippen …";
    el("typeFeedback").textContent = "";
    el("typeFeedback").className = "type-feedback";
    setTimeout(() => input.focus(), 50);

    const check = () => {
      const answers = answerAlternatives(d, dir);
      const ok = answers.includes(norm(input.value));
      input.className = "type-input " + (ok ? "correct" : "wrong");
      const fb = el("typeFeedback");
      fb.className = "type-feedback " + (ok ? "correct" : "wrong");
      fb.textContent = ok ? "Richtig!" : `Richtig wäre: ${answerPrimary(d, dir)}`;
      el("typeCheckBtn").disabled = true;
      input.disabled = true;
      const continueBtn = el("sessionContinueBtn");
      continueBtn.hidden = false;
      continueBtn.onclick = () => gradeCurrent(ok ? 3 : 1, ok);
    };
    el("typeCheckBtn").onclick = check;
    input.onkeydown = (e) => {
      if (e.key !== "Enter") return;
      if (!input.disabled) check();
      else el("sessionContinueBtn").click();
    };
    el("typeCheckBtn").disabled = false;
  }
  function norm(s) {
    return s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  function posLabel(pos) {
    return {
      noun: "Substantiv", verb: "Verb", adj: "Adjektiv", adv: "Adverb", phrase: "Redewendung",
      num: "Zahlwort", pron: "Pronomen", prep: "Präposition", conj: "Konjunktion",
    }[pos] || pos;
  }
  function germanPrimary(de) { return de.split("|")[0]; }

  // ---------- Übungsrichtung ----------
  function promptWord(d, dir) { return dir === "es-de" ? d.es : germanPrimary(d.de); }
  function answerPrimary(d, dir) { return dir === "es-de" ? germanPrimary(d.de) : d.es; }
  function answerAlternatives(d, dir) {
    return dir === "es-de" ? d.de.split("|").map(norm) : [norm(d.es)];
  }
  function promptFlag(dir) { return dir === "es-de" ? "🇪🇸" : "🇩🇪"; }

  function gradeCurrent(grade, correct) {
    const item = currentItem();
    const c = ensureCard(item.deck.es);
    if (c.state === "new") {
      const k = todayKey();
      state.newIntroducedOn[k] = (state.newIntroducedOn[k] || 0) + 1;
    }
    state.cards[item.deck.es] = SRS.review(c, grade, { desiredRetention: 0.9, mode: item.mode });
    session.reviewed += 1;
    if (correct) session.correct += 1;
    logReview(correct);
    save();

    // "Nochmal" -> Karte später in derselben Sitzung erneut einstreuen
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
    session = null;
    doneReturnView = "home";
    showView("done");
  }

  // ---------- Konjugation ----------
  let conjSelectedTenses = new Set(["presente", "indefinido"]);
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
    renderConjOverview();
  });

  function buildConjQueue() {
    const verbs = shuffle([...conjVerbsForSet(conjVerbSet)]);
    const tenses = [...conjSelectedTenses];
    const items = [];
    verbs.forEach((v) => {
      tenses.forEach((t) => {
        for (let p = 0; p < 6; p++) items.push({ infinitive: v.infinitive, tense: t, person: p });
      });
    });
    return shuffle(items).slice(0, 40);
  }

  el("startConjBtn").addEventListener("click", () => {
    const queue = buildConjQueue();
    if (!queue.length) return;
    conjSession = { queue, idx: 0, reviewed: 0, correct: 0 };
    showView("conjsession");
    renderConjItem();
  });
  el("exitConjBtn").addEventListener("click", () => { conjSession = null; showView("conj"); });

  function renderConjItem() {
    if (!conjSession || conjSession.idx >= conjSession.queue.length) return finishConjSession();
    const item = conjSession.queue[conjSession.idx];
    const verb = CONJUGATE.findVerb(item.infinitive);
    el("conjIdx").textContent = conjSession.idx + 1;
    el("conjTotal").textContent = conjSession.queue.length;
    el("conjProgressBar").style.width = `${(conjSession.idx / conjSession.queue.length) * 100}%`;
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

    state.conjRecent.unshift({
      infinitive: item.infinitive, tense: item.tense, person: item.person,
      correct: ok, typed: typed.trim(), correctForm, at: Date.now(),
    });
    if (state.conjRecent.length > 50) state.conjRecent.length = 50;
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
  el("conjContinueBtn").addEventListener("click", () => { conjSession.idx += 1; renderConjItem(); });
  el("conjInput").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (!el("conjCheckBtn").disabled && !el("conjCheckBtn").hidden) checkConjAnswer();
    else el("conjContinueBtn").click();
  });

  function finishConjSession() {
    const reviewed = conjSession ? conjSession.reviewed : 0;
    const correct = conjSession ? conjSession.correct : 0;
    el("doneReviewedLabel").textContent = "Formen geübt";
    el("doneReviewed").textContent = reviewed;
    el("doneAccuracy").textContent = reviewed ? `${Math.round((correct / reviewed) * 100)}%` : "–";
    el("doneStreakBlock").hidden = true;
    conjSession = null;
    doneReturnView = "conj";
    showView("done");
  }

  // ---------- Grammatik ----------
  let grammarSelectedCategories = new Set(GRAMMAR.CATEGORIES);
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
    return shuffle([...items]).slice(0, 40);
  }

  el("startGrammarBtn").addEventListener("click", () => {
    const queue = buildGrammarQueue();
    if (!queue.length) return;
    grammarSession = { queue, idx: 0, reviewed: 0, correct: 0 };
    showView("grammarsession");
    renderGrammarItem();
  });
  el("exitGrammarBtn").addEventListener("click", () => { grammarSession = null; showView("grammar"); });

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

    state.grammarRecent.unshift({
      id: item.id, category: item.category, prompt: item.prompt,
      correct: ok, chosen, answer: item.answer, at: Date.now(),
    });
    if (state.grammarRecent.length > 50) state.grammarRecent.length = 50;
    save();
  }

  function renderGrammarItem() {
    if (!grammarSession || grammarSession.idx >= grammarSession.queue.length) return finishGrammarSession();
    const item = grammarSession.queue[grammarSession.idx];
    el("grammarIdx").textContent = grammarSession.idx + 1;
    el("grammarTotal").textContent = grammarSession.queue.length;
    el("grammarProgressBar").style.width = `${(grammarSession.idx / grammarSession.queue.length) * 100}%`;
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
  el("grammarContinueBtn").addEventListener("click", () => { grammarSession.idx += 1; renderGrammarItem(); });

  function finishGrammarSession() {
    const reviewed = grammarSession ? grammarSession.reviewed : 0;
    const correct = grammarSession ? grammarSession.correct : 0;
    el("doneReviewedLabel").textContent = "Fragen beantwortet";
    el("doneReviewed").textContent = reviewed;
    el("doneAccuracy").textContent = reviewed ? `${Math.round((correct / reviewed) * 100)}%` : "–";
    el("doneStreakBlock").hidden = true;
    grammarSession = null;
    doneReturnView = "grammar";
    showView("done");
  }

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
      const c = state.cards[d.es];
      return `<div class="browse-item">
        <span class="bi-state">${stateEmoji(c)}</span>
        <div class="bi-main"><div class="bi-es">${d.es}</div><div class="bi-de">${d.de.replace(/\|/g, ", ")}</div></div>
        <span class="bi-level">${d.level}</span>
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

    // Balkendiagramm letzte 14 Tage
    const last14 = last30.slice(-14);
    const max = Math.max(1, ...last14.map((k) => (state.log[k] ? state.log[k].reviewed : 0)));
    el("barChart").innerHTML = last14.map((k) => {
      const d = state.log[k] || { reviewed: 0 };
      const h = Math.round((d.reviewed / max) * 100);
      const label = k.slice(8, 10);
      return `<div class="bar-col"><div class="bar-fill" style="height:${h}%"></div><div class="bar-day">${label}</div></div>`;
    }).join("");

    // Reifegrad
    const buckets = { neu: 0, lernend: 0, jung: 0, reif: 0 };
    Object.values(state.cards).forEach((c) => {
      if (c.state === "new") buckets.neu++;
      else if (c.state === "learning" || c.state === "relearning") buckets.lernend++;
      else if (c.stability >= 21) buckets.reif++;
      else buckets.jung++;
    });
    buckets.neu += DECK.length - Object.keys(state.cards).length;
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

    const hasData = state.conjRecent.length > 0;
    el("conjStatsSub").hidden = !hasData;
    el("conjStatsEmpty").style.display = hasData ? "none" : "block";
    if (!hasData) return;

    const mistakes = Object.entries(state.conjCards)
      .filter(([, c]) => c.wrongCount > 0)
      .sort((a, b) => b[1].wrongCount - a[1].wrongCount)
      .slice(0, 8);
    el("conjMistakesList").innerHTML = mistakes.length
      ? mistakes.map(([key, c]) => {
          const [infinitive, tense, person] = key.split("|");
          const form = CONJUGATE.getForms(CONJUGATE.findVerb(infinitive))[tense][Number(person)];
          return `<div class="conj-log-row">
            <span class="conj-log-icon wrong">✗</span>
            <span class="conj-log-main"><strong>${form}</strong> <span class="conj-log-dim">(${infinitive}, ${CONJUGATE.TENSE_LABELS[tense]}, ${personShort(Number(person))})</span></span>
            <span class="conj-log-count">${c.wrongCount}×</span>
          </div>`;
        }).join("")
      : `<div class="conj-log-empty">Bisher keine wiederholten Fehler — gut gemacht!</div>`;

    el("conjRecentList").innerHTML = state.conjRecent.slice(0, 15).map((r) => {
      const icon = r.correct ? `<span class="conj-log-icon correct">✓</span>` : `<span class="conj-log-icon wrong">✗</span>`;
      const detail = r.correct
        ? `<strong>${r.correctForm}</strong> <span class="conj-log-dim">(${r.infinitive}, ${CONJUGATE.TENSE_LABELS[r.tense]}, ${personShort(r.person)})</span>`
        : `<strong>${r.correctForm}</strong> <span class="conj-log-dim">(${r.infinitive}, ${CONJUGATE.TENSE_LABELS[r.tense]}, ${personShort(r.person)}) — du: „${r.typed || "–"}“</span>`;
      return `<div class="conj-log-row">${icon}<span class="conj-log-main">${detail}</span><span class="conj-log-time">${timeAgo(r.at)}</span></div>`;
    }).join("");
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

    const hasData = state.grammarRecent.length > 0;
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
          return `<div class="conj-log-row">
            <span class="conj-log-icon wrong">✗</span>
            <span class="conj-log-main">${item.prompt.replace("___", `<strong>${item.answer}</strong>`)} <span class="conj-log-dim">(${GRAMMAR.CATEGORY_LABELS[item.category]})</span></span>
            <span class="conj-log-count">${c.wrongCount}×</span>
          </div>`;
        }).join("")
      : `<div class="conj-log-empty">Bisher keine wiederholten Fehler — gut gemacht!</div>`;

    el("grammarRecentList").innerHTML = state.grammarRecent.slice(0, 15).map((r) => {
      const icon = r.correct ? `<span class="conj-log-icon correct">✓</span>` : `<span class="conj-log-icon wrong">✗</span>`;
      const filled = r.prompt.replace("___", `<strong>${r.answer}</strong>`);
      const detail = r.correct
        ? `${filled} <span class="conj-log-dim">(${GRAMMAR.CATEGORY_LABELS[r.category]})</span>`
        : `${filled} <span class="conj-log-dim">(${GRAMMAR.CATEGORY_LABELS[r.category]}) — du: „${r.chosen}“</span>`;
      return `<div class="conj-log-row">${icon}<span class="conj-log-main">${detail}</span><span class="conj-log-time">${timeAgo(r.at)}</span></div>`;
    }).join("");
  }

  el("exportDataBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(exportPayload(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vokabeltrainer-fortschritt-${todayKey()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  function renderSyncStatus() {
    const status = el("syncStatus");
    if (!window.showSaveFilePicker) {
      status.textContent = "Automatische Synchronisierung wird von diesem Browser nicht unterstützt (nur Chrome/Edge). Nutze den manuellen Export.";
      el("connectSyncBtn").disabled = true;
      return;
    }
    status.textContent = syncFileHandle
      ? `Verknüpft mit „${syncFileHandle.name}“ — wird bei jeder Änderung automatisch aktualisiert.`
      : "Noch keine Datei verknüpft.";
  }

  el("connectSyncBtn").addEventListener("click", async () => {
    if (!window.showSaveFilePicker) return;
    try {
      syncFileHandle = await window.showSaveFilePicker({
        suggestedName: "vokabeltrainer-fortschritt.json",
        types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
      });
      await writeSyncFile();
      renderSyncStatus();
    } catch (e) { /* Nutzer hat den Dialog abgebrochen */ }
  });

  // Enter drückt den sichtbaren "Weiter"-Button, auch wenn das Eingabefeld
  // gerade deaktiviert ist (deaktivierte Inputs erhalten keine eigenen Key-Events mehr).
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    ["sessionContinueBtn", "conjContinueBtn", "grammarContinueBtn"].some((id) => {
      const btn = el(id);
      if (btn && !btn.hidden) { btn.click(); return true; }
      return false;
    });
  });

  // ---------- Start ----------
  renderHome();
})();
