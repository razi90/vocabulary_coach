/* Tageslektion: Hören, Schreiben, Sprechen.

   Die drei Teile funktionieren unterschiedlich: Hören wird sofort ausgewertet
   (geschlossene Fragen), Schreiben und Sprechen kann die App nicht bewerten –
   sie werden abgegeben und der Coach meldet später zurück. Das ist bewusst so:
   eine automatische Bewertung freier Texte wäre geraten, nicht gemessen. */
const LESSON = (() => {
  const el = (id) => document.getElementById(id);
  const esc = TEXT.esc;

  let lesson = null;
  let onSubmitted = () => {};

  const zeit = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const woerter = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);

  async function load() {
    lesson = await (await fetch("/api/lesson")).json();
    render();
  }

  function render() {
    const hat = !!(lesson && lesson.id);
    el("lessonEmpty").hidden = hat;
    el("lessonBody").hidden = !hat;
    if (!hat) return;

    el("lessonDate").textContent = new Date(lesson.day).toLocaleDateString("de-DE",
      { weekday: "long", day: "2-digit", month: "long" });
    el("lessonTitle").textContent = lesson.title;
    el("lessonMeta").textContent = [lesson.theme, `Niveau ${lesson.level}`].filter(Boolean).join(" · ");

    const abgaben = lesson.submissions || {};
    renderListening(lesson.listening, abgaben.listening);
    renderWriting(lesson.writing, abgaben.writing);
    renderSpeaking(lesson.speaking, abgaben.speaking);
  }

  /** Rückmeldung des Coaches – oder der Hinweis, dass sie noch aussteht. */
  function renderFeedback(boxId, abgabe) {
    const box = el(boxId);
    if (!abgabe) { box.hidden = true; return; }
    box.hidden = false;
    if (abgabe.feedback) {
      box.innerHTML = `<div class="lesson-feedback-head">Rückmeldung deines Coaches</div>${esc(abgabe.feedback)}`;
    } else {
      box.innerHTML = `<div class="lesson-feedback-head">Abgegeben</div>` +
        `<span class="lesson-await">Warte auf die Rückmeldung deines Coaches. ` +
        `Frag ihn beim nächsten Mal danach.</span>`;
    }
  }

  // ---------- Hören ----------
  function renderListening(teil, abgabe) {
    el("partListening").hidden = !teil;
    if (!teil) return;
    el("doneListening").hidden = !abgabe;
    el("listeningTask").textContent = teil.task;
    // nocookie-Variante: kein Tracking, solange nicht abgespielt wird.
    el("listeningFrame").src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(teil.videoId)}`;
    el("listeningCaption").textContent = `${teil.videoTitle} — ${teil.channel}`;

    const box = el("listeningQuestions");
    const submit = el("listeningSubmit");
    if (abgabe) {
      const c = abgabe.content || {};
      box.innerHTML = `<div class="lesson-counter reached">${c.correct} von ${c.total} richtig</div>`;
      submit.hidden = true;
      renderFeedback("listeningFeedback", abgabe);
      return;
    }

    const gewaehlt = new Map();
    box.innerHTML = "";
    teil.questions.forEach((frage, i) => {
      const wrap = document.createElement("div");
      wrap.className = "lesson-question";
      wrap.innerHTML = `<p class="lesson-task" lang="es" style="margin-bottom:8px;">${i + 1}. ${esc(frage.prompt)}</p>`;
      const grid = document.createElement("div");
      grid.className = "mc-grid";
      frage.options.forEach((opt) => {
        const b = document.createElement("button");
        b.className = "mc-option";
        b.lang = "es";
        b.textContent = opt;
        b.addEventListener("click", () => {
          grid.querySelectorAll(".mc-option").forEach((o) => o.classList.remove("correct"));
          b.classList.add("correct");
          gewaehlt.set(i, opt);
          submit.hidden = gewaehlt.size !== teil.questions.length;
        });
        grid.appendChild(b);
      });
      wrap.appendChild(grid);
      box.appendChild(wrap);
    });

    submit.hidden = true;
    submit.onclick = async () => {
      const antworten = teil.questions.map((f, i) => ({
        prompt: f.prompt, gewaehlt: gewaehlt.get(i), richtig: f.answer,
        ok: gewaehlt.get(i) === f.answer,
      }));
      const correct = antworten.filter((a) => a.ok).length;
      // Auflösung zeigen, bevor der Teil einklappt.
      box.querySelectorAll(".lesson-question").forEach((wrap, i) => {
        wrap.querySelectorAll(".mc-option").forEach((o) => {
          o.classList.add("disabled");
          if (o.textContent === teil.questions[i].answer) o.classList.add("correct");
          else if (o.textContent === gewaehlt.get(i)) { o.classList.remove("correct"); o.classList.add("wrong"); }
        });
        const erk = teil.questions[i].explanation;
        if (erk) wrap.insertAdjacentHTML("beforeend", `<p class="speak-hint">${esc(erk)}</p>`);
      });
      submit.hidden = true;
      await abgeben("listening", { answers: antworten, correct, total: antworten.length });
    };
  }

  // ---------- Schreiben ----------
  function renderWriting(teil, abgabe) {
    el("partWriting").hidden = !teil;
    if (!teil) return;
    el("doneWriting").hidden = !abgabe;
    el("writingPrompt").textContent = teil.prompt;
    el("writingMin").textContent = teil.minWords;

    const feld = el("writingText");
    const submit = el("writingSubmit");
    const ziele = el("writingTargets");
    ziele.innerHTML = teil.targetWords.map((w) =>
      `<span class="target-word" data-wort="${esc(TEXT.norm(w))}">${esc(w)}</span>`).join("");

    if (abgabe) {
      feld.value = (abgabe.content || {}).text || "";
      feld.disabled = true;
      submit.hidden = true;
      markiereZiele(ziele, feld.value);
      el("writingCount").textContent = woerter(feld.value);
      renderFeedback("writingFeedback", abgabe);
      return;
    }

    feld.disabled = false;
    submit.hidden = false;
    const pruefe = () => {
      const n = woerter(feld.value);
      el("writingCount").textContent = n;
      el("writingCount").parentElement.classList.toggle("reached", n >= teil.minWords);
      submit.disabled = n < teil.minWords;
      markiereZiele(ziele, feld.value);
    };
    feld.oninput = pruefe;
    pruefe();

    submit.onclick = async () => {
      feld.disabled = true;
      submit.hidden = true;
      await abgeben("writing", { text: feld.value.trim(), words: woerter(feld.value) });
    };
  }

  /** Zielwörter abhaken, sobald sie im Text auftauchen. */
  function markiereZiele(box, text) {
    const norm = TEXT.norm(text);
    box.querySelectorAll(".target-word").forEach((chip) => {
      chip.classList.toggle("used", norm.includes(chip.dataset.wort));
    });
  }

  // ---------- Sprechen ----------
  let erkennung = null;
  let sekunden = 0;
  let uhr = null;

  function renderSpeaking(teil, abgabe) {
    el("partSpeaking").hidden = !teil;
    if (!teil) return;
    el("doneSpeaking").hidden = !abgabe;
    el("speakingTopic").textContent = teil.topic;
    el("speakingPrompts").innerHTML = teil.prompts.map((p) => `<li>${esc(p)}</li>`).join("");
    el("speakingPhrases").innerHTML = teil.usefulPhrases.map((p) =>
      `<span class="target-word">${esc(p)}</span>`).join("");
    el("speakTimer").textContent = `0:00 / ${zeit(teil.minSeconds)}`;

    const feld = el("speakingText");
    const start = el("speakStart");
    const submit = el("speakingSubmit");

    if (abgabe) {
      feld.value = (abgabe.content || {}).transcript || "";
      feld.disabled = true;
      start.hidden = true;
      submit.hidden = true;
      el("speakHint").textContent = "";
      renderFeedback("speakingFeedback", abgabe);
      return;
    }

    feld.disabled = false;
    start.hidden = false;
    submit.hidden = false;
    const Erkenner = window.SpeechRecognition || window.webkitSpeechRecognition;
    el("speakHint").textContent = Erkenner
      ? "Sprich frei. Was erkannt wird, erscheint unten — du kannst es vor dem Abgeben korrigieren."
      : "Dieser Browser kann keine Spracherkennung. Sprich laut und tippe danach ein, was du gesagt hast.";
    start.hidden = !Erkenner;

    const pruefe = () => { submit.disabled = woerter(feld.value) < 5; };
    feld.oninput = pruefe;
    pruefe();

    start.onclick = () => (erkennung ? stoppen() : starten(teil, Erkenner, feld, start, pruefe));

    submit.onclick = async () => {
      stoppen();
      feld.disabled = true;
      start.hidden = true;
      submit.hidden = true;
      await abgeben("speaking", { transcript: feld.value.trim(), seconds: sekunden });
    };
  }

  function starten(teil, Erkenner, feld, start, pruefe) {
    erkennung = new Erkenner();
    erkennung.lang = "es-ES";
    erkennung.continuous = true;
    erkennung.interimResults = true;
    let fest = feld.value ? feld.value + " " : "";

    erkennung.onresult = (e) => {
      let vorlaeufig = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const stueck = e.results[i][0].transcript;
        if (e.results[i].isFinal) fest += stueck + " ";
        else vorlaeufig += stueck;
      }
      feld.value = (fest + vorlaeufig).replace(/\s+/g, " ").trim();
      pruefe();
    };
    erkennung.onerror = (e) => {
      const grund = {
        "not-allowed": "Zugriff aufs Mikrofon wurde abgelehnt. Tippe stattdessen ein, was du gesagt hast.",
        "service-not-allowed": "Die Spracherkennung ist in diesem Browser gesperrt. Tippe stattdessen ein.",
        "no-speech": "Nichts gehört — sprich etwas lauter oder näher am Mikrofon.",
        network: "Die Spracherkennung braucht eine Internetverbindung.",
      }[e.error] || `Spracherkennung fehlgeschlagen (${e.error}). Tippen geht immer.`;
      const hinweis = el("speakHint");
      hinweis.textContent = grund;
      hinweis.classList.add("warn");
      stoppen();
    };
    erkennung.onend = () => { if (erkennung) stoppen(); };

    try { erkennung.start(); }
    catch (e) { el("speakHint").textContent = "Aufnahme ließ sich nicht starten: " + e.message; erkennung = null; return; }

    start.textContent = "Aufnahme stoppen";
    start.classList.add("recording");
    sekunden = 0;
    uhr = setInterval(() => {
      sekunden += 1;
      el("speakTimer").textContent = `${zeit(sekunden)} / ${zeit(teil.minSeconds)}`;
      el("speakTimer").style.color = sekunden >= teil.minSeconds ? "var(--good)" : "";
    }, 1000);
  }

  function stoppen() {
    if (erkennung) { try { erkennung.stop(); } catch (e) { /* egal */ } erkennung = null; }
    clearInterval(uhr);
    const start = el("speakStart");
    start.textContent = "Aufnahme starten";
    start.classList.remove("recording");
  }

  // ---------- Abgabe ----------
  async function abgeben(part, content) {
    try {
      await fetch(`/api/lesson/${lesson.id}/submit`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ part, content }),
      });
      await load();
      onSubmitted(part);
    } catch (e) {
      alert("Abgabe fehlgeschlagen: " + e.message);
    }
  }

  return {
    load, render, stoppen,
    hatLektion: () => !!(lesson && lesson.id),
    setOnSubmitted: (fn) => { onSubmitted = fn; },
  };
})();
