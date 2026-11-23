/* Dictation into a text field with the browser's speech recognition, in the
   course language. Used by the speaking task of a unit.

   The recognition is not on the device: Chrome sends the audio to Google,
   Safari and Edge to their own services. Brave, Opera and other Chromium
   browsers ship the API but cannot reach that service. Then the learner
   speaks aloud and types what they said; the hint says so, and the app
   stops retrying for this page. (lesson.js has the same rules for the
   coach's daily lesson.) */
const DICTATION = (() => {
  const Recognizer = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
  let broken = typeof navigator !== "undefined" && !!navigator.brave;
  let active = null;   // { rec, field, button, hint, onChange }

  const NONE = "Hier gibt es keine Spracherkennung. Sprich laut und tippe danach ein, was du gesagt hast.";
  const BRAVE = "In Brave gibt es keine Spracherkennung. Sprich laut und tippe danach ein, was du gesagt hast. " +
    "In Chrome, Edge oder Safari erscheint der Text von selbst.";
  const ERRORS = {
    network: "Die Spracherkennung dieses Browsers ist nicht erreichbar. Sprich laut und tippe danach ein, was du gesagt hast.",
    "service-not-allowed": "Die Spracherkennung ist in diesem Browser gesperrt. Tippe ein, was du gesagt hast.",
    "language-not-supported": "Für diese Sprache gibt es hier keine Spracherkennung. Tippe ein, was du gesagt hast.",
    "audio-capture": "Kein Mikrofon gefunden. Sprich trotzdem laut und tippe danach ein, was du gesagt hast.",
    "not-allowed": "Zugriff aufs Mikrofon wurde abgelehnt. Tippe stattdessen ein, was du gesagt hast.",
  };

  /** What to tell the learner before they start. */
  function intro() {
    if (typeof navigator !== "undefined" && navigator.brave) return BRAVE;
    return Recognizer && !broken ? "Sprich frei. Was erkannt wird, erscheint im Feld – du kannst es danach korrigieren." : NONE;
  }

  function say(text, warn) {
    if (!active) return;
    active.hint.textContent = text;
    active.hint.classList.toggle("warn", !!warn);
  }

  function stop() {
    if (!active) return;
    const { rec, button } = active;
    active.running = false;
    if (rec) { active.rec = null; try { rec.stop(); } catch (e) { /* already stopped */ } }
    button.textContent = "Aufnahme starten";
    button.classList.remove("recording");
  }

  /** Starts or stops dictating into `field`. */
  function toggle({ field, button, hint, onChange }) {
    if (active && active.running) { stop(); return; }
    active = { field, button, hint, onChange, running: true, rec: null };
    button.textContent = "Aufnahme stoppen";
    button.classList.add("recording");
    if (!Recognizer || broken) { say(intro()); return; }

    const rec = new Recognizer();
    active.rec = rec;
    rec.lang = COURSE.speechLang;
    rec.continuous = true;
    rec.interimResults = true;
    let fixed = field.value ? field.value + " " : "";
    let restarts = [];
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const piece = e.results[i][0].transcript;
        if (e.results[i].isFinal) fixed += piece + " "; else interim += piece;
      }
      field.value = (fixed + interim).replace(/\s+/g, " ").trim();
      if (onChange) onChange();
    };
    rec.onerror = (e) => {
      if (e.error === "aborted") return;
      if (e.error === "no-speech") { say("Nichts gehört – sprich etwas lauter oder näher am Mikrofon.", true); return; }
      if (e.error !== "not-allowed") broken = true;
      say(ERRORS[e.error] || `Spracherkennung fehlgeschlagen (${e.error}). Tippe ein, was du gesagt hast.`, true);
      stop();
    };
    // Chrome ends a continuous recognition after a pause; start again while the
    // learner has not stopped, unless it keeps dying at once.
    rec.onend = () => {
      if (!active || active.rec !== rec || !active.running) return;
      const now = Date.now();
      restarts = restarts.filter((t) => now - t < 5000).concat(now);
      if (restarts.length > 3) { broken = true; say(NONE, true); stop(); return; }
      try { rec.start(); } catch (err) { stop(); }
    };
    try { rec.start(); } catch (e) { broken = true; say(NONE, true); stop(); }
  }

  return { intro, toggle, stop };
})();
