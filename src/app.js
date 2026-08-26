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
    };
  }
  function migrate(s) {
    s.cards = s.cards || {};
    s.log = s.log || {};
    s.newIntroducedOn = s.newIntroducedOn || {};
    s.dailyGoal = s.dailyGoal || 20;
    s.streak = s.streak || 0;
    return s;
  }
  let state = loadState();
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* Speicher voll o.ä. */ }
    }, 150);
  }

  function ensureCard(id) {
    if (!state.cards[id]) state.cards[id] = SRS.newCard(id);
    return state.cards[id];
  }

  const NEW_PER_DAY_CAP = 12;

  function cardsDueNow(now = Date.now()) {
    return DECK.filter((d) => {
      const c = state.cards[d.es];
      return c && c.state !== "new" && c.due <= now;
    });
  }
  function cardsNewAvailable() {
    const introducedToday = state.newIntroducedOn[todayKey()] || 0;
    const remainingCap = Math.max(0, NEW_PER_DAY_CAP - introducedToday);
    const fresh = DECK.filter((d) => !state.cards[d.es] || state.cards[d.es].state === "new");
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
    if (name === "stats") renderStats();
    if (name === "home") renderHome();
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
    if (due + fresh === 0) {
      startBtn.disabled = true;
      startBtn.textContent = "Alles erledigt für heute ✓";
      el("sessionHint").textContent = "Komm morgen für neue Wiederholungen wieder.";
    } else {
      startBtn.disabled = false;
      startBtn.textContent = "Sitzung starten";
      el("sessionHint").textContent = `${due} fällig, ${fresh} neu · Karteikarten · Multiple Choice · Tippen`;
    }
  }

  el("dailyGoal").addEventListener("input", (e) => {
    state.dailyGoal = Number(e.target.value);
    el("dailyGoalDisplay").textContent = state.dailyGoal;
    el("dailyGoalNum").textContent = state.dailyGoal;
    save();
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
  el("doneContinueBtn").addEventListener("click", () => showView("home"));

  function currentItem() { return session.queue[session.idx]; }

  function renderCurrentCard() {
    if (!session || session.idx >= session.queue.length) return finishSession();
    const item = currentItem();
    const d = item.deck;
    el("sessionIdx").textContent = session.idx + 1;
    el("sessionTotal").textContent = session.queue.length;
    el("sessionProgressBar").style.width = `${(session.idx / session.queue.length) * 100}%`;

    ["flip", "mc", "type"].forEach((m) => el(`mode-${m}`).hidden = m !== item.mode);

    if (item.mode === "flip") renderFlip(d);
    else if (item.mode === "mc") renderMC(d);
    else renderType(d);
  }

  // --- Karteikarte ---
  const flashcardEl = el("flashcard");
  const flashcardInner = el("flashcardInner");
  let flipped = false;

  function renderFlip(d) {
    flipped = false;
    flashcardEl.classList.remove("flipped");
    el("flipPos").textContent = posLabel(d.pos);
    el("flipFront").textContent = d.es;
    el("flipBack").textContent = germanPrimary(d.de);
    el("flipEx").textContent = d.ex || "";
    el("flipExDe").textContent = d.exDe || "";
    el("gradeRow").classList.add("hidden-until-flip");

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
    el("mcPos").textContent = posLabel(d.pos);
    el("mcPrompt").textContent = d.es;
    const correct = germanPrimary(d.de);
    const distractors = shuffle(
      DECK.filter((x) => x.es !== d.es && x.pos === d.pos).map((x) => germanPrimary(x.de))
    );
    let options = distractors.slice(0, 3);
    if (options.length < 3) {
      const more = shuffle(DECK.filter((x) => x.es !== d.es).map((x) => germanPrimary(x.de)))
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
        setTimeout(() => gradeCurrent(ok ? 3 : 1, ok), ok ? 500 : 900);
      });
      grid.appendChild(b);
    });
  }

  // --- Tippen ---
  function renderType(d) {
    el("typePos").textContent = posLabel(d.pos);
    el("typePrompt").textContent = d.es;
    const input = el("typeInput");
    input.value = "";
    input.className = "type-input";
    input.disabled = false;
    el("typeFeedback").textContent = "";
    el("typeFeedback").className = "type-feedback";
    setTimeout(() => input.focus(), 50);

    const check = () => {
      const answers = d.de.split("|").map(norm);
      const ok = answers.includes(norm(input.value));
      input.className = "type-input " + (ok ? "correct" : "wrong");
      const fb = el("typeFeedback");
      fb.className = "type-feedback " + (ok ? "correct" : "wrong");
      fb.textContent = ok ? "Richtig!" : `Richtig wäre: ${germanPrimary(d.de)}`;
      el("typeCheckBtn").disabled = true;
      input.disabled = true;
      setTimeout(() => gradeCurrent(ok ? 3 : 1, ok), ok ? 500 : 1400);
    };
    el("typeCheckBtn").onclick = check;
    input.onkeydown = (e) => { if (e.key === "Enter") check(); };
    el("typeCheckBtn").disabled = false;
  }
  function norm(s) {
    return s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }

  function posLabel(pos) {
    return { noun: "Substantiv", verb: "Verb", adj: "Adjektiv", adv: "Adverb", phrase: "Redewendung" }[pos] || pos;
  }
  function germanPrimary(de) { return de.split("|")[0]; }

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
    el("doneReviewed").textContent = reviewed;
    el("doneAccuracy").textContent = reviewed ? `${Math.round((correct / reviewed) * 100)}%` : "–";
    el("doneStreak").textContent = state.streak;
    session = null;
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
  }
  function last30Keys() {
    const out = [];
    for (let i = 29; i >= 0; i--) out.push(todayKey(Date.now() - i * DAY));
    return out;
  }

  // ---------- Start ----------
  renderHome();
})();
