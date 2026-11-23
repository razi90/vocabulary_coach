/* Reading words aloud with the browser's built-in speech (no server, no cost).

   Only the course-language side is spoken. Without a voice for the course
   language every speaker button stays hidden - a button that does nothing
   would be worse than none. Buttons are marked with data-say="text". */
const SPEECH = (() => {
  const synth = typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
  let voices = [];

  function voiceFor(lang) {
    const want = String(lang).toLowerCase();
    const base = want.split("-")[0];
    return voices.find((v) => v.lang.toLowerCase().replace("_", "-") === want)
      || voices.find((v) => v.lang.toLowerCase().startsWith(base)) || null;
  }
  const available = () => !!(synth && voiceFor(COURSE.speechLang));

  /** Shows or hides every speaker button below root. */
  function updateButtons(root = document) {
    const on = available();
    root.querySelectorAll("[data-say]").forEach((b) => {
      if (b.dataset.sayHidden === "1") return;   // the caller keeps it hidden for now (e.g. answer not revealed)
      b.hidden = !on;
    });
  }

  function speak(text) {
    const voice = voiceFor(COURSE.speechLang);
    if (!synth || !voice || !text) return false;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = 0.92;
    synth.speak(u);
    return true;
  }

  /**
   * Reads several texts one after another (a dialogue). onLine(i) is called
   * as line i starts, and with -1 when the last one ends or reading stops.
   */
  function speakAll(texts, onLine = () => {}) {
    const voice = voiceFor(COURSE.speechLang);
    if (!synth || !voice || !texts.length) return false;
    synth.cancel();
    texts.forEach((text, i) => {
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = 0.9;
      u.onstart = () => onLine(i);
      if (i === texts.length - 1) u.onend = () => onLine(-1);
      u.onerror = () => onLine(-1);
      synth.speak(u);
    });
    return true;
  }
  function stopSpeaking() { if (synth) synth.cancel(); }

  function refresh() {
    voices = synth ? synth.getVoices() : [];
    updateButtons();
  }
  if (synth) {
    refresh();
    if (synth.addEventListener) synth.addEventListener("voiceschanged", refresh);
  }

  // Capture phase: a speaker inside a clickable row must not also open the row.
  if (typeof document !== "undefined") {
    document.addEventListener("click", (e) => {
      const b = e.target.closest && e.target.closest("[data-say]");
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      speak(b.dataset.say);
    }, true);
  }

  return { available, speak, speakAll, stopSpeaking, updateButtons };
})();
