/* The word detail sheet: everything about one word in one place.

   Opens from anything marked data-word="<term>" (word list, session end,
   hardest words). A native <dialog>: it traps focus, closes with Escape and
   returns focus to what opened it. All data comes from the browser
   (INSIGHTS over cards, events and the deck) - no extra request. */
const WORDSHEET = (() => {
  const el = (id) => document.getElementById(id);
  const esc = TEXT.esc;
  const icon = (name, cls = "icon") => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const POS = {
    noun: "Substantiv", verb: "Verb", adj: "Adjektiv", adv: "Adverb", phrase: "Redewendung",
    num: "Zahlwort", pron: "Pronomen", prep: "Präposition", conj: "Konjunktion",
  };
  const STATE = { new: "neu", learning: "am Lernen", young: "jung", mature: "gefestigt" };

  let data = { cards: () => ({}), events: () => [] };

  function when(due) {
    if (due == null) return "sobald du das Wort lernst";
    const days = Math.round((due - Date.now()) / 86400000);
    if (days <= 0) return "heute";
    if (days === 1) return "morgen";
    if (days < 31) return `in ${days} Tagen`;
    return new Date(due).toLocaleDateString("de-DE", { day: "numeric", month: "long" });
  }

  function slipLine(s) {
    const what = s.almost ? "fast richtig"
      : s.confusedWith ? `verwechselt mit ${esc(s.confusedWith.term)} (${esc(s.confusedWith.de)})`
      : "falsch";
    return `<li><s>${esc(s.typed)}</s> <span>— ${what}</span></li>`;
  }

  function render(d) {
    const h = INSIGHTS.wordHistory(d.term, { events: data.events(), card: data.cards()[d.term], deck: DECK });
    const meanings = d.de.split("|");
    return `
      <div class="sheet-grab" aria-hidden="true"></div>
      <button class="icon-btn sheet-close" data-sheet-close aria-label="Schließen">${icon("x", "icon sm")}</button>
      <div class="sheet-head">
        <div class="grow">
          <h2 class="sheet-term" id="wordSheetTitle" lang="${COURSE.lang}">${esc(d.term)}</h2>
          <div class="sheet-de">${meanings.map(esc).join(", ")}</div>
        </div>
        <button class="icon-btn speak-btn" data-say="${esc(d.term)}" aria-label="Aussprechen" hidden>${icon("speaker")}</button>
      </div>
      <div class="tags">
        ${[POS[d.pos] || d.pos, d.level, d.topic].filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}
      </div>
      ${d.ex ? `<div class="sheet-ex">
        <p lang="${COURSE.lang}">${esc(d.ex)}</p>
        <button class="icon-btn speak-btn sm" data-say="${esc(d.ex)}" aria-label="Beispielsatz aussprechen" hidden>${icon("speaker", "icon sm")}</button>
      </div>
      ${d.exDe ? `<p class="sheet-ex-de">${esc(d.exDe)}</p>` : ""}` : ""}
      <dl class="kv">
        <div><dt>Richtig</dt><dd>${h.attempts ? `${h.correct} von ${h.attempts}` : "noch nicht geübt"}</dd></div>
        <div><dt>Stand</dt><dd>${STATE[h.state]}</dd></div>
        <div><dt>Wieder dran</dt><dd>${when(h.due)}</dd></div>
      </dl>
      ${h.slips.length ? `<div class="section-label">Zuletzt getippt</div><ul class="slips">${h.slips.map(slipLine).join("")}</ul>` : ""}`;
  }

  function open(term) {
    const d = DECK.find((x) => x.term === term);
    const dialog = el("wordSheet");
    if (!d || !dialog) return;
    dialog.innerHTML = `<div class="sheet-body">${render(d)}</div>`;
    SPEECH.updateButtons(dialog);
    if (!dialog.open) dialog.showModal();
  }

  function init(getters) {
    data = { ...data, ...getters };
    const dialog = el("wordSheet");
    document.addEventListener("click", (e) => {
      const opener = e.target.closest("[data-word]");
      if (opener) { e.preventDefault(); open(opener.dataset.word); }
    });
    dialog.addEventListener("click", (e) => {
      // The backdrop is the dialog itself; the content sits in its children.
      if (e.target === dialog || e.target.closest("[data-sheet-close]")) dialog.close();
    });
  }

  return { init, open };
})();
