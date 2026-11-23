/* The course path on screen: the Kurs section, a unit, an explanation, the
   unit check and the placement. What to show is decided in path.js; this
   file only draws it and wires the buttons. The trainers belong to app.js,
   which hands them in through init(). */
const PATHUI = (() => {
  let deps = null;
  let built = null;
  let openUnitId = null;
  let run = null;        // the check or placement in progress

  const el = (id) => document.getElementById(id);
  const esc = TEXT.esc;
  const icon = (name, cls = "icon") => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const BACK_LABELS = { unit: "Einheit", home: "Heute", grammar: "Grammatik", conj: "Verben", course: "Kurs" };

  function ctx() {
    const st = deps.state();
    return { path: st.path, cards: deps.cards(), grammarCards: st.grammarCards, conjCards: st.conjCards, grammarItems: GRAMMAR.ITEMS };
  }
  const content = () => ({ deck: DECK, grammarItems: GRAMMAR.ITEMS, conj: CONJUGATE });
  const where = (u) => `${u.level} · Einheit ${u.posInLevel} von ${u.ofLevel}`;
  const guideFor = (u) => (u.focus ? built.guides[PATH.guideKey(u.focus)] : null);
  const focusTitle = (u) => { const g = guideFor(u); return g ? g.title : ""; };
  const currentUnit = () => PATH.current(built, ctx());

  function init(d) {
    deps = d;
    built = PATH.build(COURSE_PATH, DECK);
    const st = deps.state();
    const before = JSON.stringify(st.path || null);
    st.path = PATH.migrate(built, st.path, deps.cards());
    if (JSON.stringify(st.path) !== before) deps.save();

    el("courseRoute").addEventListener("click", (e) => {
      const b = e.target.closest("[data-unit]");
      if (b) openUnit(b.dataset.unit);
    });
    el("homeUnit").addEventListener("click", () => {
      const u = currentUnit();
      if (u) openUnit(u.id); else deps.showView("course");
    });
    el("unitSteps").addEventListener("click", (e) => {
      const g = e.target.closest("[data-guide]");
      if (g) { openGuide(g.dataset.guide, "unit"); return; }
      if (e.target.closest("[data-focus-practice]")) { practise(built.byId.get(openUnitId), "unit"); return; }
      const st = e.target.closest("[data-step]");
      if (st) { const step = unitStepsShown.find((x) => x.kind === st.dataset.step); if (step) runStep(step, "unit"); }
    });
    el("unitPrimary").addEventListener("click", () => unitAction && unitAction());
    el("unitCheckAnyway").addEventListener("click", () => startCheck(openUnitId, "unit"));
    el("guidePractice").addEventListener("click", () => {
      const key = el("guidePractice").dataset.guide;
      const [kind, id] = key.split(":");
      deps.practise(kind, id, el("guideBack").dataset.back);
    });
    // "Mehr dazu" links in the grammar and verb trainers.
    document.addEventListener("click", (e) => {
      const g = e.target.closest("[data-guide-from]");
      if (g) openGuide(g.dataset.guide, g.dataset.guideFrom);
    });

    el("dialogTranslate").addEventListener("click", () => showTranslation(!el("dialogLines").classList.contains("show-de")));
    el("dialogPlay").addEventListener("click", playDialog);
    el("dialogQuestions").addEventListener("click", () => startLessonRun(openUnitId, "dialog", lessonBack));
    el("taskText").addEventListener("input", () => {
      el("taskSubmit").disabled = el("taskText").value.trim().split(/\s+/).filter(Boolean).length < 3;
    });
    el("taskRecord").addEventListener("click", () => DICTATION.toggle({
      field: el("taskText"), button: el("taskRecord"), hint: el("taskHint"),
      onChange: () => el("taskText").dispatchEvent(new Event("input")),
    }));
    el("taskSubmit").addEventListener("click", submitTask);
    el("taskBack").addEventListener("click", () => backTo(lessonBack));

    el("checkGrid").addEventListener("click", (e) => {
      const b = e.target.closest(".mc-option");
      if (b && !b.classList.contains("disabled")) choose(b);
    });
    el("checkCheckBtn").addEventListener("click", submitTyped);
    el("checkInput").addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      e.stopPropagation();     // one Enter checks, the next one continues
      if (!el("checkInput").disabled) submitTyped();
    });
    el("checkSkipBtn").addEventListener("click", () => answer("", "wrong"));
    el("checkContinueBtn").addEventListener("click", () => { run.idx += 1; renderItem(); });
    el("exitCheckBtn").addEventListener("click", leaveRun);
    el("checkResultPrimary").addEventListener("click", () => resultActions.primary && resultActions.primary());
    el("checkResultSecondary").addEventListener("click", () => resultActions.secondary && resultActions.secondary());
  }

  // ---------- Heute ----------

  function unitMeta(u, p) {
    const parts = [`${p.words.done} von ${p.words.total} Wörtern`];
    if (p.focus) parts.push(focusTitle(u));
    parts.push(p.check.passed ? "Check bestanden" : "Check");
    return parts.join(" · ");
  }

  /** The head of Heute's panel: which unit today's steps belong to. */
  function renderBanner() {
    const u = currentUnit();
    if (!u) {
      el("homeUnitWhere").textContent = `${COURSE.nameDe} · alle Niveaus`;
      el("homeUnitTitle").textContent = "Kurs abgeschlossen";
      el("homeUnitGoal").textContent = "Wiederhole deine Wörter und hol dir im Coach neue Übungen.";
      return;
    }
    el("homeUnitWhere").textContent = where(u);
    el("homeUnitTitle").textContent = u.title;
    el("homeUnitGoal").textContent = u.goal;
  }

  const plan = (counts) => PATH.plan(built, ctx(), counts);

  /** The words of a step as the primary button says them. */
  function stepLabel(step) {
    switch (step.kind) {
      case "dialog": return "Dialog lesen";
      case "vocab": return "Neue Wörter lernen";
      case "focus": return `Weiter mit „${step.title}“`;
      case "sentences": return "Sätze bauen";
      case "task": return step.title.split(":")[0] === "Schreiben" ? "Aufgabe schreiben" : "Sprechen üben";
      default: return "Abschluss-Check starten";
    }
  }

  /** Runs a step of a unit; `back` is where its screen returns to. */
  function runStep(step, back = "home") {
    const u = step.unitId && built.byId.get(step.unitId);
    if (step.kind === "vocab") { if (!deps.startVocab() && back === "unit") renderUnit(); return; }
    if (!u) return;
    if (step.kind === "dialog") openDialog(u.id, back);
    else if (step.kind === "focus") {
      const p = PATH.progress(u, ctx());
      if (!p.focus.seen) openGuide(p.focus.key, back); else practise(u, back);
    } else if (step.kind === "sentences") startLessonRun(u.id, "sentences", back);
    else if (step.kind === "task") openTask(u.id, back);
    else if (step.kind === "check") startCheck(u.id, back);
  }

  function practise(u, back) {
    if (!u || !u.focus) return;
    deps.practise(u.focus.kind, u.focus.id, back);
  }

  // ---------- Kurs ----------

  function stopMeta(u, p, isCurrent) {
    if (p.status === "done") return p.check.best != null ? `Abgeschlossen · ${p.check.best} %` : "Abgeschlossen";
    if (p.status === "skipped") return p.via === "legacy" ? "Wörter schon gelernt" : "Übersprungen";
    if (isCurrent || p.words.done) return unitMeta(u, p);
    return [`${u.words.length} Wörter`, focusTitle(u)].filter(Boolean).join(" · ");
  }

  function renderCourse() {
    const c = ctx();
    const now = currentUnit();
    const finished = built.units.filter((u) => PATH.progress(u, c).finished).length;
    el("courseSub").textContent = `${COURSE.nameDe} · ${finished} von ${built.units.length} Einheiten geschafft`;
    el("courseRoute").innerHTML = built.levels.map((level) => {
      const done = level.units.filter((u) => PATH.progress(u, c).finished).length;
      const state = done === level.units.length ? "done" : now && now.level === level.id ? "now" : "ahead";
      const stops = level.units.map((u) => {
        const p = PATH.progress(u, c);
        const isCurrent = now && now.id === u.id;
        const cls = p.finished ? "done" : isCurrent ? "current" : "ahead";
        return `<li class="stop ${cls}">
          <button class="stop-btn" data-unit="${esc(u.id)}"${isCurrent ? ' aria-current="step"' : ""}>
            <span class="stop-dot" aria-hidden="true">${p.finished ? icon("check", "icon") : ""}</span>
            <span class="grow"><span class="title">${esc(u.title)}</span><span class="meta">${esc(stopMeta(u, p, isCurrent))}</span></span>
            ${icon("chev", "icon chev")}
          </button></li>`;
      }).join("");
      return `<section class="route-level ${state}" aria-label="Niveau ${esc(level.id)}">
        <header class="route-head">
          <span class="route-code">${esc(level.id)}</span>
          <span class="grow"><span class="route-title">${esc(level.title || "")}</span><span class="route-goal">${esc(level.goal || "")}</span></span>
          <span class="route-count">${done} von ${level.units.length}</span>
        </header>
        <ol class="route-stops">${stops}</ol>
      </section>`;
    }).join("");
  }

  // ---------- A unit ----------

  let unitAction = null;

  function openUnit(id) {
    openUnitId = id;
    renderUnit();
    deps.showView("unit");
  }

  function renderUnit() {
    const u = built.byId.get(openUnitId) || currentUnit() || built.units[0];
    openUnitId = u.id;
    const c = ctx();
    const p = PATH.progress(u, c);
    const now = currentUnit();
    const isCurrent = now && now.id === u.id;
    const byTerm = new Map(DECK.map((d) => [d.term, d]));
    el("unitWhere").textContent = where(u);
    el("unitTitle").textContent = u.title;
    el("unitGoal").textContent = u.goal;

    const chip = (t) => {
      const known = c.cards[t] && c.cards[t].state !== "new";
      const d = byTerm.get(t);
      return `<button class="word-chip${known ? " known" : ""}" data-word="${esc(t)}" lang="${COURSE.lang}" title="${esc(d ? d.de.replace(/\|/g, ", ") : "")}">${esc(t)}</button>`;
    };
    // A lesson unit learns the dialogue's words first, then the rest of its topics.
    const fromLesson = new Set(u.vocab || []);
    const own = u.words.filter((t) => fromLesson.has(t));
    const more = u.words.filter((t) => !fromLesson.has(t));
    const chips = own.length
      ? `<p class="chip-group-label">Aus dem Dialog</p><div class="word-chips">${own.map(chip).join("")}</div>`
        + (more.length ? `<p class="chip-group-label">Mehr zum Thema</p><div class="word-chips">${more.map(chip).join("")}</div>` : "")
      : `<div class="word-chips">${more.map(chip).join("")}</div>`;
    // The unit's own steps (path.js); the unit the learner is in counts today's words.
    const steps = PATH.steps(built, u, c, isCurrent ? deps.counts() : undefined);
    const n = PATH.checkItems(u, c, content(), () => 0.5).length;
    const link = (attr, label) => `<button class="link-btn" ${attr}>${label}</button>`;
    const EXTRA = {
      dialog: () => `<div class="step-links">${link('data-step="dialog"', "Dialog öffnen")}</div>`,
      vocab: () => chips,
      focus: () => `<div class="step-links">${link(`data-guide="${esc(PATH.guideKey(u.focus))}"`, "Erklärung lesen")}
          ${link("data-focus-practice", "Üben")}</div>`,
      sentences: () => `<div class="step-links">${link('data-step="sentences"', "Sätze üben")}</div>`,
      task: () => `<div class="step-links">${link('data-step="task"', "Aufgabe öffnen")}</div>`,
      check: () => "",
    };
    const TITLES = { vocab: "Wörter kennenlernen", focus: `${u.focus && u.focus.kind === "tense" ? "Zeitform" : "Grammatik"}: ${focusTitle(u)}` };
    const checkMeta = p.check.passed ? `Bestanden${p.check.best != null ? ` mit ${p.check.best} %` : ""}`
      : p.check.best != null ? `Bisher bestes Ergebnis ${p.check.best} %. Ab 80 % bestanden.`
      : `${n} Fragen, ab 80 % bestanden.${p.words.complete ? "" : " Erst, wenn alle Wörter gelernt sind."}`;
    const next = p.status === "done" ? null : PATH.nextStep(steps);
    el("unitSteps").innerHTML = steps.map((s, i) => `<li class="unit-step${s.done ? " done" : ""}${s.later ? " later" : ""}${s === next ? " next" : ""}">
        <span class="step-num" aria-hidden="true">${s.done ? icon("check", "icon sm") : i + 1}</span>
        <div class="grow"><h2 class="step-title">${esc(TITLES[s.kind] || s.title)}</h2>
          <p class="step-meta">${esc(s.kind === "check" ? checkMeta : s.meta)}</p>${EXTRA[s.kind]()}</div>
      </li>`).join("");
    unitStepsShown = steps;

    // One primary action: whatever comes next in this unit.
    const btn = el("unitPrimary");
    const hint = el("unitHint");
    btn.disabled = false;
    btn.hidden = false;
    hint.textContent = "";
    if (p.status === "done") {
      const after = built.units[u.index + 1];
      btn.textContent = after ? `Weiter zu „${after.title}“` : "Zum Kurs";
      unitAction = after ? () => openUnit(after.id) : () => deps.showView("course");
    } else if (!isCurrent && !p.words.complete) {
      btn.textContent = "Diese Einheit lernen";
      hint.textContent = now ? `Neue Wörter kommen dann aus dieser Einheit statt aus „${now.title}“.` : "";
      unitAction = () => pick(u.id);
    } else if (next) {
      btn.textContent = stepLabel(next);
      unitAction = () => runStep(next, "unit");
    } else {
      btn.textContent = "Morgen geht es weiter";
      btn.disabled = true;
      hint.textContent = "Für heute hast du genug neue Wörter gelernt.";
      unitAction = null;
    }
    el("unitCheckAnyway").hidden = p.status === "done" || (next && next.kind === "check");
  }
  let unitStepsShown = [];

  /** The learner wants this unit next: its words become the new ones on offer. */
  function pick(id) {
    const st = deps.state();
    st.path = { ...st.path, focus: id };
    deps.save();
    if (!deps.startVocab()) { renderUnit(); }
  }

  // ---------- Explanations ----------

  let openGuideKey = null;
  function openGuide(key, back) {
    const g = built.guides[key];
    if (!g) return;
    openGuideKey = key;
    const st = deps.state();
    st.path.guides = { ...st.path.guides, [key]: Date.now() };
    deps.save();
    el("guideTitle").textContent = g.title;
    el("guideBody").innerHTML = g.body.map((t) => `<p>${esc(t)}</p>`).join("");
    el("guideExamples").innerHTML = g.examples.map((e) => `<li>
        <span class="ex-line"><span class="ex-t" lang="${COURSE.lang}">${esc(e.t)}</span>
          <button class="icon-btn speak-btn" data-say="${esc(e.t)}" aria-label="Aussprechen" hidden>${icon("speaker", "icon sm")}</button></span>
        <span class="ex-de" lang="de">${esc(e.de)}</span>
        ${e.note ? `<span class="ex-note">${esc(e.note)}</span>` : ""}
      </li>`).join("");
    if (typeof SPEECH !== "undefined") SPEECH.updateButtons(el("guideExamples"));
    const backTo = BACK_LABELS[back] ? back : "course";
    el("guideBack").dataset.back = backTo;
    el("guideBackLabel").textContent = BACK_LABELS[backTo];
    el("guidePractice").dataset.guide = key;
    deps.showView("guide");
  }

  // ---------- Check and placement ----------

  let resultActions = {};

  function startCheck(unitId, back) {
    const u = built.byId.get(unitId);
    if (!u) return;
    openUnitId = u.id;
    run = { mode: "check", unitId, back: back || "unit", items: PATH.checkItems(u, ctx(), content()), idx: 0, correct: 0, missed: [] };
    deps.touchStreak();
    showRun();
  }

  function startPlacement() {
    run = { mode: "placement", level: built.levels[0].id, passed: [], idx: 0, correct: 0, missed: [] };
    run.items = PATH.placementItems(built, run.level, content());
    showRun();
  }
  const isPlacing = () => !!run && run.mode === "placement";

  // ---------- A unit's lesson: dialogue, sentences, speaking or writing ----------

  let lessonBack = "unit";
  function backTo(where) {
    if (where === "unit") { renderUnit(); deps.showView("unit"); } else deps.showView(where);
  }

  function openDialog(unitId, back = "unit") {
    const u = built.byId.get(unitId);
    if (!u || !u.lesson) return;
    openUnitId = u.id;
    lessonBack = back;
    const d = u.lesson.dialogue;
    el("dialogTitle").textContent = d.title;
    el("dialogScene").textContent = d.scene;
    el("dialogLines").innerHTML = d.lines.map((l, i) => `<li class="dialog-line" data-line="${i}">
        <span class="dialog-who">${esc(l.who)}</span>
        <span class="grow"><span class="dialog-t" lang="${COURSE.lang}">${esc(l.t)}</span>
          <span class="dialog-de" lang="de">${esc(l.de)}</span></span>
        <button class="icon-btn speak-btn" data-say="${esc(l.t)}" aria-label="Zeile anhören" hidden>${icon("speaker", "icon sm")}</button>
      </li>`).join("");
    if (typeof SPEECH !== "undefined") SPEECH.updateButtons(el("dialogLines"));
    el("dialogPlay").hidden = !(typeof SPEECH !== "undefined" && SPEECH.available());
    showTranslation(false);
    el("view-dialog").querySelector(".back-link").dataset.back = back === "home" ? "home" : "unit";
    deps.showView("dialog");
  }
  function showTranslation(on) {
    el("dialogLines").classList.toggle("show-de", on);
    el("dialogTranslate").setAttribute("aria-pressed", on ? "true" : "false");
    el("dialogTranslate").textContent = on ? "Übersetzung ausblenden" : "Übersetzung zeigen";
  }
  function playDialog() {
    const u = built.byId.get(openUnitId);
    const lines = [...el("dialogLines").querySelectorAll(".dialog-line")];
    const mark = (i) => lines.forEach((li, k) => li.classList.toggle("speaking", k === i));
    SPEECH.speakAll(u.lesson.dialogue.lines.map((l) => l.t), mark);
  }

  /** Dialogue questions or sentences, in the item player. */
  function startLessonRun(unitId, part, back = "unit") {
    const u = built.byId.get(unitId);
    if (!u || !u.lesson) return;
    if (typeof SPEECH !== "undefined") SPEECH.stopSpeaking();
    run = { mode: part, unitId, back, items: PATH.lessonItems(u, part), idx: 0, correct: 0, missed: [] };
    if (part === "sentences") deps.touchStreak();
    showRun();
  }

  function finishLessonRun(r, total) {
    const u = built.byId.get(r.unitId);
    const st = deps.state();
    st.path = PATH.recordLesson(st.path, u.id, r.mode === "dialog" ? "dialog" : "sentences", { right: r.correct, total });
    deps.save();
    run = null;
    const next = PATH.nextStep(PATH.steps(built, u, ctx(), currentUnit() && currentUnit().id === u.id ? deps.counts() : undefined));
    const toUnit = { label: "Zur Einheit", run: () => openUnit(u.id) };
    showResult({
      ok: r.correct * 2 >= total,
      title: r.mode === "dialog" ? "Dialog verstanden" : "Sätze gebaut",
      text: `${r.correct} von ${total} richtig.${r.correct < total ? " Schau dir unten an, was noch nicht saß." : ""}`,
      missed: r.missed,
      primary: next ? { label: `Weiter: ${stepLabel(next)}`, run: () => runStep(next, r.back) } : toUnit,
      secondary: next ? toUnit : { label: "Zu Heute", run: () => deps.showView("home") },
    });
  }

  let taskUnitId = null;
  function openTask(unitId, back = "unit") {
    const u = built.byId.get(unitId);
    if (!u || !u.lesson) return;
    taskUnitId = u.id;
    openUnitId = u.id;
    lessonBack = back;
    const t = u.lesson.task;
    const done = PATH.progress(u, ctx()).lesson.task;
    el("taskKind").textContent = t.kind === "speak" ? "Sprechen" : "Schreiben";
    el("taskTitle").textContent = t.title;
    el("taskPrompt").textContent = t.prompt;
    el("taskPhrases").innerHTML = t.phrases.map((x) => `<span class="word-chip known" lang="${COURSE.lang}">${esc(x)}</span>`).join("");
    const field = el("taskText");
    field.value = done ? done.text : "";
    field.disabled = false;
    field.placeholder = t.kind === "speak" ? "Sprich laut – oder tippe, was du sagst …" : "Schreib deine Antwort …";
    const rec = el("taskRecord");
    rec.hidden = t.kind !== "speak";
    el("taskHint").textContent = t.kind === "speak" ? DICTATION.intro() : "";
    el("taskHint").classList.remove("warn");
    el("taskSubmit").hidden = false;
    el("taskSubmit").disabled = field.value.trim().split(/\s+/).filter(Boolean).length < 3;
    el("taskModelBlock").hidden = true;
    el("view-task").querySelector(".back-link").dataset.back = back === "home" ? "home" : "unit";
    deps.showView("task");
  }
  function submitTask() {
    const u = built.byId.get(taskUnitId);
    DICTATION.stop();
    const text = el("taskText").value.trim();
    const st = deps.state();
    st.path = PATH.recordLesson(st.path, u.id, "task", { text });
    deps.save();
    deps.touchStreak();
    el("taskSubmit").hidden = true;
    el("taskRecord").hidden = true;
    el("taskModel").textContent = u.lesson.task.model;
    el("taskModelSay").dataset.say = u.lesson.task.model;
    if (typeof SPEECH !== "undefined") SPEECH.updateButtons(el("taskModelBlock"));
    el("taskModelBlock").hidden = false;
    el("taskModelBlock").scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function showRun() {
    el("checkRun").hidden = false;
    el("checkResult").hidden = true;
    deps.showView("check");
    renderItem();
  }

  function askFor(item) {
    if (item.kind === "grammar") return "Welches Wort passt in die Lücke?";
    if (item.kind === "conj") return `${item.meta}: Wie heißt die Form?`;
    if (item.kind === "dialog") return "Frage zum Dialog";
    if (item.kind === "sentence") return `Wie sagt man das ${COURSE.inDe}?`;
    return item.type === "choice" ? "Was heißt das?" : `Wie heißt das ${COURSE.inDe}?`;
  }

  function renderItem() {
    if (run.idx >= run.items.length) return finish();
    const item = run.items[run.idx];
    el("checkIdx").textContent = run.idx + 1;
    el("checkTotal").textContent = run.items.length;
    el("checkProgressBar").style.width = `${(run.idx / run.items.length) * 100}%`;
    el("checkAsk").textContent = run.mode === "placement" && run.idx === 0
      ? `Einstufung ${run.level} · ${askFor(item)}` : askFor(item);
    const prompt = el("checkPrompt");
    prompt.textContent = item.prompt;
    prompt.lang = (item.kind === "vocab" && item.type === "type") || item.kind === "sentence" ? "de" : COURSE.lang;
    el("checkMeta").textContent = "";
    el("checkFeedback").textContent = "";
    el("checkFeedback").className = "type-feedback";
    el("checkExplanation").textContent = "";
    el("checkContinueBtn").hidden = true;
    el("checkSkipBtn").hidden = false;

    const grid = el("checkGrid");
    const typed = el("checkTypedWrap");
    if (item.type === "choice") {
      typed.hidden = true;
      grid.hidden = false;
      grid.innerHTML = item.options.map((o, i) =>
        `<button class="mc-option" data-answer="${esc(o)}" lang="${item.kind === "vocab" ? "de" : COURSE.lang}"><span class="mc-key">${i + 1}</span>${esc(o)}</button>`).join("");
    } else {
      grid.hidden = true;
      grid.innerHTML = "";
      typed.hidden = false;
      const input = el("checkInput");
      input.value = "";
      input.disabled = false;
      input.className = "type-input";
      input.lang = COURSE.lang;
      el("checkCheckBtn").hidden = false;
      setTimeout(() => input.focus(), 50);
    }
  }

  function choose(b) {
    const item = run.items[run.idx];
    answer(b.dataset.answer, b.dataset.answer === item.answer ? "exact" : "wrong", b);
  }

  function submitTyped() {
    const item = run.items[run.idx];
    const value = el("checkInput").value;
    // Verb forms are judged like the verb trainer: exactly, accents aside.
    const verdict = item.kind === "conj"
      ? (item.accepted.some((f) => TEXT.norm(f) === TEXT.norm(value)) ? "exact" : "wrong")
      : TEXT.judge(value, item.accepted);
    answer(value.trim(), verdict);
  }

  function answer(given, verdict, chosenBtn) {
    const item = run.items[run.idx];
    if (!el("checkContinueBtn").hidden) return;      // already answered
    const ok = verdict !== "wrong";
    if (item.type === "choice") {
      el("checkGrid").querySelectorAll(".mc-option").forEach((o) => {
        o.classList.add("disabled");
        if (o.dataset.answer === item.answer) o.classList.add("correct");
        else if (o === chosenBtn) o.classList.add("wrong");
      });
    } else {
      const input = el("checkInput");
      input.disabled = true;
      input.className = "type-input " + (ok ? "correct" : "wrong");
      el("checkCheckBtn").hidden = true;
    }
    const fb = el("checkFeedback");
    fb.className = "type-feedback " + (ok ? "correct" : "wrong");
    fb.textContent = verdict === "exact" ? COURSE.praise
      : verdict === "close" ? `Fast – richtig geschrieben: ${item.answer}` : `Richtig wäre: ${item.answer}`;
    if (item.explanation && run.mode === "check") el("checkExplanation").textContent = item.explanation;
    el("checkSkipBtn").hidden = true;

    if (ok) run.correct += 1;
    else run.missed.push({ title: item.answer, meta: item.prompt, term: item.kind === "vocab" ? item.term : null });
    if (run.mode === "check" || run.mode === "sentences") log(item, ok, given);

    const cont = el("checkContinueBtn");
    cont.hidden = false;
    cont.textContent = run.idx + 1 < run.items.length ? "Weiter" : "Ergebnis";
    cont.focus();
  }

  /* Check answers are real answers and go into the log like any other. They
     do not reschedule cards. Placement answers are not logged: the learner
     was never taught those words, so a miss is no confusion. */
  function log(item, ok, given) {
    if (item.kind === "vocab") {
      deps.logEvent({ kind: "vocab", id: item.term, dir: item.dir, mode: "check", ok, typed: given, expected: item.answer });
    } else if (item.kind === "grammar") {
      const it = GRAMMAR.findItem(item.id);
      if (it) deps.logGrammarAttempt(it, ok, given);
    } else if (item.kind === "sentence") {
      deps.logEvent({ kind: "sentence", id: item.id, prompt: item.prompt, ok, typed: given, expected: item.answer });
    } else if (item.kind === "conj") {
      deps.logConjAttempt({ infinitive: item.infinitive, tense: item.tense, person: item.person }, ok, item.answer, given);
    }
  }

  function leaveRun() {
    const r = run;
    run = null;
    if (r && r.mode === "placement") { settlePlacement(r.passed); deps.showView("home"); return; }
    backTo(r ? r.back : "home");
  }

  function settlePlacement(passedLevels) {
    const st = deps.state();
    st.path = PATH.applyPlacement(built, st.path, passedLevels);
    deps.save();
  }

  function showResult({ ok, title, text, missed = [], primary, secondary }) {
    el("checkRun").hidden = true;
    el("checkResult").hidden = false;
    el("checkResultMark").classList.toggle("not-yet", !ok);
    el("checkResultMark").innerHTML = icon(ok ? "check" : "refresh");
    el("checkResultTitle").textContent = title;
    el("checkResultText").textContent = text;
    el("checkMissedBlock").hidden = !missed.length;
    el("checkMissed").innerHTML = missed.slice(0, 12).map((m) => `<${m.term ? `button class="list-row" data-word="${esc(m.term)}"` : 'div class="list-row"'}>
        <span class="grow"><span class="title" lang="${COURSE.lang}">${esc(m.title)}</span><span class="meta">${esc(m.meta)}</span></span>
        ${m.term ? icon("chev", "icon chev") : ""}</${m.term ? "button" : "div"}>`).join("");
    el("checkResultPrimary").textContent = primary.label;
    el("checkResultSecondary").hidden = !secondary;
    if (secondary) el("checkResultSecondary").textContent = secondary.label;
    resultActions = { primary: primary.run, secondary: secondary && secondary.run };
    el("checkResultPrimary").focus();
  }

  function finish() {
    const r = run;
    const total = r.items.length;
    el("checkProgressBar").style.width = "100%";
    if (r.mode === "check") finishCheck(r, total);
    else if (r.mode === "dialog" || r.mode === "sentences") finishLessonRun(r, total);
    else finishPlacementRound(r, total);
  }

  function finishCheck(r, total) {
    const u = built.byId.get(r.unitId);
    const pct = total ? Math.round((r.correct / total) * 100) : 0;
    const st = deps.state();
    const prev = st.path.checks[u.id];
    st.path.checks = { ...st.path.checks, [u.id]: { best: Math.max(pct, prev ? prev.best : 0), last: pct, at: Date.now() } };
    const passed = PATH.passed(r.correct, total);
    if (passed) st.path = PATH.completeUnit(st.path, u.id);
    deps.save();
    run = null;
    const home = { label: "Zu Heute", run: () => deps.showView("home") };
    if (passed) {
      const next = currentUnit();
      showResult({
        ok: true, title: "Einheit geschafft",
        text: `${r.correct} von ${total} richtig. „${u.title}“ ist abgeschlossen.`,
        primary: next ? { label: `Weiter zu „${next.title}“`, run: () => openUnit(next.id) } : { label: "Zum Kurs", run: () => deps.showView("course") },
        secondary: home,
        missed: r.missed,
      });
    } else {
      showResult({
        ok: false, title: "Noch nicht ganz",
        text: `${r.correct} von ${total} richtig. Ab ${Math.ceil(total * PATH.CHECK_PASS)} hast du bestanden. Wiederhole die Wörter unten und versuch es dann noch einmal.`,
        missed: r.missed,
        primary: { label: "Zur Einheit", run: () => openUnit(u.id) },
        secondary: { label: "Nochmal versuchen", run: () => startCheck(u.id, r.back) },
      });
    }
  }

  function finishPlacementRound(r, total) {
    const need = Math.min(PATH.PLACEMENT_PASS, Math.ceil(total * 0.7));
    const levelPassed = r.correct >= need;
    const passed = levelPassed ? [...r.passed, r.level] : r.passed;
    const next = levelPassed ? PATH.nextLevel(built, r.level) : null;
    const toHome = { label: "Los geht's", run: () => { run = null; deps.showView("home"); } };
    const toCourse = { label: "Zum Kurs", run: () => { run = null; deps.showView("course"); } };
    if (levelPassed && next) {
      run = { ...r, passed };
      showResult({
        ok: true, title: `${r.level} sitzt`,
        text: `${r.correct} von ${total} richtig. Möchtest du auch ${next} testen?`,
        primary: { label: `${next} testen`, run: () => {
          run = { mode: "placement", level: next, passed, idx: 0, correct: 0, missed: [] };
          run.items = PATH.placementItems(built, next, content());
          showRun();
        } },
        secondary: { label: `Bei ${next} anfangen`, run: () => { settlePlacement(passed); run = null; deps.showView("home"); } },
      });
      return;
    }
    settlePlacement(passed);
    run = { ...r, passed, mode: "placement-done" };
    const start = currentUnit();
    if (!start) {
      showResult({ ok: true, title: "Du kennst den ganzen Kurs",
        text: "Alle Einheiten sind übersprungen. Du kannst jede öffnen, ihre Wörter lernen oder ihren Check machen.",
        primary: toHome, secondary: toCourse });
      return;
    }
    showResult({
      ok: true, title: passed.length ? `Du startest bei ${start.level}` : "Du startest am Anfang",
      text: passed.length
        ? `${passed.join(" und ")} kannst du schon, bei ${r.level} waren es ${r.correct} von ${total}. Los geht es mit „${start.title}“.`
        : `Los geht es mit „${start.title}“. Die ersten Wörter lernst du heute.`,
      primary: toHome, secondary: toCourse,
    });
  }

  return {
    init, renderBanner, renderCourse, renderUnit, openUnit, openGuide, plan, stepLabel, runStep,
    /** What a reload needs to reopen the same path screen. */
    position: () => ({ unit: openUnitId, guide: openGuideKey, back: el("guideBack").dataset.back, lessonBack }),
    /** Reopens a path screen after a reload; false when there is nothing to reopen. */
    restore(view, pos) {
      if (!pos) return false;
      if (view === "unit" && built.byId.has(pos.unit)) { openUnit(pos.unit); return true; }
      if (view === "dialog" && built.byId.has(pos.unit)) { openDialog(pos.unit, pos.lessonBack); return true; }
      if (view === "task" && built.byId.has(pos.unit)) { openTask(pos.unit, pos.lessonBack); return true; }
      if (view === "guide" && built.guides[pos.guide]) {
        if (built.byId.has(pos.unit)) openUnitId = pos.unit;
        openGuide(pos.guide, pos.back);
        return true;
      }
      return false;
    },
    stopLesson: () => { DICTATION.stop(); if (typeof SPEECH !== "undefined") SPEECH.stopSpeaking(); },
    freshTerms: () => PATH.freshTerms(built, ctx()),
    /** The learner's level: that of the current unit, or the last one when the path is done. */
    currentLevel: () => { const u = currentUnit(); return u ? u.level : built.levels[built.levels.length - 1].id; },
    categoryLevels: () => PATH.categoryLevels(built),
    startCheck, startPlacement, isPlacing,
  };
})();
