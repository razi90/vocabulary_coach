/* Gemeinsame Text- und Antwortlogik. Wird von der App und von den
   Übungssätzen genutzt, damit "richtig" überall dasselbe bedeutet. */
const TEXT = (() => {
  /** Kleinschreibung ohne Akzente – Akzente sind beim Tippen optional. */
  function norm(s) {
    return String(s == null ? "" : s).trim().toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      // Satzzeichen am Rand und doppelte Leerzeichen sind nie der Lernstoff.
      .replace(/^[¡¿"'«»(]+|[.,;:!?"'«»)]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** Pflicht bei jedem innerHTML mit Nutzereingaben oder freiem Text. */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));

  /** Levenshtein-Distanz, abgebrochen sobald sie das Limit überschreitet. */
  function editDistance(a, b, limit) {
    if (Math.abs(a.length - b.length) > limit) return limit + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let rowMin = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > limit) return limit + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  /* Ein Vertipper ist: gleich viele Wörter, höchstens eines weicht ab, und
     dieses eine nur geringfügig.

     Zeichendistanz über den ganzen Satz wäre zu großzügig: "gracias para tu
     ayuda" liegt nur zwei Zeichen von "gracias por tu ayuda" entfernt, ist
     aber kein Vertipper, sondern genau der Fehler, der geübt werden soll. */
  function isTypo(a, b) {
    const wa = a.split(/\s+/), wb = b.split(/\s+/);
    if (wa.length !== wb.length) return false;
    let differing = -1;
    for (let i = 0; i < wa.length; i++) {
      if (wa[i] === wb[i]) continue;
      if (differing >= 0) return false;      // mehr als ein abweichendes Wort
      differing = i;
    }
    if (differing < 0) return false;
    const given = wa[differing], target = wb[differing];
    // Vertauschte Nachbarbuchstaben sind auch bei kurzen Wörtern ein Vertipper
    // ("pro" statt "por"), eine echte Wortverwechslung dagegen nicht.
    if (isSwap(given, target)) return true;
    const limit = target.length >= 8 ? 2 : target.length >= 4 ? 1 : 0;
    return limit > 0 && editDistance(given, target, limit) <= limit;
  }

  /** Genau zwei benachbarte Zeichen vertauscht? */
  function isSwap(a, b) {
    if (a.length !== b.length) return false;
    const diff = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i);
    return diff.length === 2 && diff[1] === diff[0] + 1 &&
           a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
  }

  /**
   * "exact" | "close" | "wrong". Ein Vertipper soll eine Karte nicht
   * auf "nochmal" zurückwerfen, deshalb die mittlere Stufe.
   */
  function judge(typed, alternatives) {
    const value = norm(typed);
    if (!value) return "wrong";
    const alts = alternatives.map(norm).filter(Boolean);
    if (alts.includes(value)) return "exact";
    for (const alt of alts) if (isTypo(value, alt)) return "close";
    return "wrong";
  }

  return { norm, esc, editDistance, judge, isTypo };
})();

/* Auch aus Node nutzbar (Server und MCP), damit Prüfregeln nicht doppelt existieren. */
if (typeof module !== "undefined" && module.exports) module.exports = TEXT;
