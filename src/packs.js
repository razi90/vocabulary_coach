/* Exercise sets ("packs") that an agent writes and the app plays back.

   The format is the interface between Claude and the app, and therefore
   versioned. New item types are added to ITEM_TYPES; every type says how it
   is validated. Rendering deliberately lives in the UI layer (app.js), so
   this file stays testable without a DOM. */
const PACKS = (() => {
  const SCHEMA = "vocab-coach/exercise-pack@1";
  const MAX_ITEMS = 100;

  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const strList = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

  /* An item type describes: what an item has to look like (normalize),
     whether it is valid (validate) and when an answer is right (check). */
  const ITEM_TYPES = {
    choice: {
      label: "Auswahl",
      normalize: (raw) => ({
        type: "choice",
        prompt: str(raw.prompt),
        options: strList(raw.options),
        answer: str(raw.answer),
        explanation: str(raw.explanation),
        lang: str(raw.lang) || "es",
      }),
      validate: (it) => {
        if (!it.prompt) return "prompt fehlt";
        if (it.options.length < 2) return "mindestens zwei options nötig";
        if (it.options.length > 6) return "höchstens sechs options";
        if (!it.answer) return "answer fehlt";
        if (!it.options.includes(it.answer)) return `answer "${it.answer}" ist keine der options`;
        return null;
      },
      // Multiple choice is unambiguous: only an exact match counts.
      check: (it, given) => (given === it.answer ? "exact" : "wrong"),
      accepted: (it) => [it.answer],
    },

    cloze: {
      label: "Lückentext",
      normalize: (raw) => ({
        type: "cloze",
        prompt: str(raw.prompt),
        answer: str(raw.answer),
        alternatives: strList(raw.alternatives),
        hint: str(raw.hint),
        explanation: str(raw.explanation),
        lang: str(raw.lang) || "es",
      }),
      validate: (it) => {
        if (!it.prompt) return "prompt fehlt";
        if (!it.prompt.includes("___")) return "prompt braucht eine Lücke (___)";
        if (!it.answer) return "answer fehlt";
        return null;
      },
      check: (it, given) => TEXT.judge(given, [it.answer, ...it.alternatives]),
      accepted: (it) => [it.answer, ...it.alternatives],
    },

    translate: {
      label: "Übersetzung",
      normalize: (raw) => ({
        type: "translate",
        prompt: str(raw.prompt),
        answer: str(raw.answer),
        alternatives: strList(raw.alternatives),
        from: str(raw.from) || "de",
        to: str(raw.to) || "es",
        explanation: str(raw.explanation),
      }),
      validate: (it) => {
        if (!it.prompt) return "prompt fehlt";
        if (!it.answer) return "answer fehlt";
        return null;
      },
      check: (it, given) => TEXT.judge(given, [it.answer, ...it.alternatives]),
      accepted: (it) => [it.answer, ...it.alternatives],
    },
  };

  const typeNames = () => Object.keys(ITEM_TYPES);

  /**
   * Turn raw JSON into a validated pack.
   * Returns { pack, errors } - a pack with a few broken items is still
   * played, the broken items drop out. An agent must not be able to bring
   * the app to a halt.
   */
  function parse(raw, source = "unbekannt") {
    const errors = [];
    if (!raw || typeof raw !== "object") return { pack: null, errors: [`${source}: kein JSON-Objekt`] };
    if (str(raw.schema) !== SCHEMA) {
      return { pack: null, errors: [`${source}: schema muss "${SCHEMA}" sein (war: ${str(raw.schema) || "fehlt"})`] };
    }
    const id = str(raw.id);
    if (!id) return { pack: null, errors: [`${source}: id fehlt`] };
    if (!Array.isArray(raw.items) || !raw.items.length) {
      return { pack: null, errors: [`${source}: items fehlt oder ist leer`] };
    }

    const items = [];
    raw.items.slice(0, MAX_ITEMS).forEach((rawItem, i) => {
      const typeName = str(rawItem && rawItem.type) || "choice";
      const type = ITEM_TYPES[typeName];
      if (!type) { errors.push(`${source}: Aufgabe ${i + 1} hat unbekannten type "${typeName}"`); return; }
      const item = type.normalize(rawItem);
      const problem = type.validate(item);
      if (problem) { errors.push(`${source}: Aufgabe ${i + 1} (${typeName}) – ${problem}`); return; }
      items.push(item);
    });
    if (raw.items.length > MAX_ITEMS) errors.push(`${source}: nur die ersten ${MAX_ITEMS} Aufgaben werden genutzt`);
    if (!items.length) return { pack: null, errors: errors.length ? errors : [`${source}: keine gültige Aufgabe`] };

    return {
      pack: {
        id,
        title: str(raw.title) || id,
        description: str(raw.description),
        createdBy: str(raw.createdBy) || "unbekannt",
        createdAt: str(raw.createdAt) || new Date().toISOString(),
        focus: strList(raw.focus),
        items,
        source,
        addedAt: Date.now(),
      },
      errors,
    };
  }

  const checkAnswer = (item, given) => ITEM_TYPES[item.type].check(item, given);
  const acceptedAnswers = (item) => ITEM_TYPES[item.type].accepted(item);
  const typeLabel = (name) => (ITEM_TYPES[name] ? ITEM_TYPES[name].label : name);

  return { SCHEMA, ITEM_TYPES, typeNames, parse, checkAnswer, acceptedAnswers, typeLabel };
})();

/* Usable from Node too (server and MCP), so the rules exist only once. */
if (typeof module !== "undefined" && module.exports) module.exports = PACKS;
