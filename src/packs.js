/* Übungssätze ("Packs"), die ein Agent schreibt und die App abspielt.

   Das Format ist die Schnittstelle zwischen Claude und der App und deshalb
   versioniert. Neue Aufgabentypen kommen in ITEM_TYPES dazu; jeder Typ sagt,
   wie er geprüft wird. Die Darstellung liegt bewusst in der UI-Schicht
   (app.js), damit diese Datei ohne DOM testbar bleibt. */
const PACKS = (() => {
  const SCHEMA = "vocab-coach/exercise-pack@1";
  const MAX_ITEMS = 100;

  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const strList = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

  /* Ein Aufgabentyp beschreibt: wie eine Aufgabe aussehen muss (normalize),
     ob sie gültig ist (validate) und wann eine Antwort richtig ist (check). */
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
      // Auswahl ist eindeutig: nur exakte Übereinstimmung zählt.
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
   * Rohes JSON in einen geprüften Pack verwandeln.
   * Gibt { pack, errors } zurück – ein Pack mit einzelnen kaputten Aufgaben
   * wird trotzdem gespielt, die kaputten Aufgaben fallen heraus. Ein Agent
   * soll die App nicht lahmlegen können.
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

/* Auch aus Node nutzbar (Server und MCP), damit Prüfregeln nicht doppelt existieren. */
if (typeof module !== "undefined" && module.exports) module.exports = PACKS;
