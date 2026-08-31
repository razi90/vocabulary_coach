/* Shared text and answer logic. Used by the app and by the exercise sets, so
   that "correct" means the same thing everywhere. */
const TEXT = (() => {
  /** Lower case without accents - accents are optional when typing. */
  function norm(s) {
    return String(s == null ? "" : s).trim().toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      // Edge punctuation and double spaces are never the material.
      .replace(/^[¡¿"'«»(]+|[.,;:!?"'«»)]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** Mandatory for every innerHTML with user input or free text. */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));

  /** Levenshtein distance, aborted as soon as it exceeds the limit. */
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

  /* A typo is: the same number of words, at most one of them differing, and
     that one only slightly.

     Character distance across the whole sentence would be too generous:
     "gracias para tu ayuda" is only two characters from "gracias por tu ayuda"
     but is not a typo - it is exactly the mistake the exercise is meant to
     test. */
  function isTypo(a, b) {
    const wa = a.split(/\s+/), wb = b.split(/\s+/);
    if (wa.length !== wb.length) return false;
    let differing = -1;
    for (let i = 0; i < wa.length; i++) {
      if (wa[i] === wb[i]) continue;
      if (differing >= 0) return false;      // more than one differing word
      differing = i;
    }
    if (differing < 0) return false;
    const given = wa[differing], target = wb[differing];
    // Swapped neighbouring letters are a typo even in short words ("pro"
    // instead of "por"); a genuine word mix-up is not.
    if (isSwap(given, target)) return true;
    const limit = target.length >= 8 ? 2 : target.length >= 4 ? 1 : 0;
    return limit > 0 && editDistance(given, target, limit) <= limit;
  }

  /** Exactly two adjacent characters swapped? */
  function isSwap(a, b) {
    if (a.length !== b.length) return false;
    const diff = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i);
    return diff.length === 2 && diff[1] === diff[0] + 1 &&
           a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
  }

  /**
   * "exact" | "close" | "wrong". A typo should not throw a card back to
   * "again", hence the middle level.
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

/* Usable from Node too (server and MCP), so the rules exist only once. */
if (typeof module !== "undefined" && module.exports) module.exports = TEXT;
