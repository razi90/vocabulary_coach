/* English verb forms for German speakers.

   Same interface as courses/es/conjugate.js. English has little inflection,
   so the trainer concentrates on what actually goes wrong: the irregular
   past forms, the -s in the third person, and choosing the right auxiliary
   (am/is/are, have/has). Forms are given without the pronoun, as in Spanish:
   "he/she/it, Present Perfect, go" -> "has gone". */
const CONJUGATE = (() => {
  const TENSES = ["simple_present", "present_progressive", "simple_past", "present_perfect", "will_future", "conditional"];
  const TENSE_LABELS = {
    simple_present: "Simple Present",
    present_progressive: "Present Progressive",
    simple_past: "Simple Past",
    present_perfect: "Present Perfect",
    will_future: "will-Future",
    conditional: "Conditional (would)",
  };
  const PERSON_LABELS = ["I", "you", "he/she/it", "we", "you (Plural)", "they"];
  const TENSE_EXPLANATIONS = {
    simple_present: "Für Gewohnheiten, Fakten und Fahrpläne. Signalwörter: always, usually, every day. Achtung: he/she/it bekommt ein -s. Beispiel: „She works in a bank.“ – Sie arbeitet in einer Bank.",
    present_progressive: "Für das, was gerade jetzt passiert oder vorübergehend ist: am/is/are + -ing. Beispiel: „I'm reading a book at the moment.“ – Ich lese gerade ein Buch. Im Deutschen gibt es diese Form nicht – deshalb wird sie oft vergessen.",
    simple_past: "Für abgeschlossene Handlungen zu einem bestimmten Zeitpunkt in der Vergangenheit (yesterday, last week, in 2019, ago). Beispiel: „I saw him yesterday.“ – Ich habe ihn gestern gesehen. Achtung: Im Deutschen steht hier oft das Perfekt.",
    present_perfect: "Für Vergangenes mit Bezug zur Gegenwart, ohne genauen Zeitpunkt (ever, never, already, yet, since, for). have/has + 3. Form. Beispiel: „I have lived here for ten years.“ – Ich wohne seit zehn Jahren hier.",
    will_future: "Für Vorhersagen, spontane Entschlüsse und Versprechen: will + Grundform, für alle Personen gleich. Beispiel: „I'll call you later.“ – Ich rufe dich später an.",
    conditional: "Für Höflichkeit, Wünsche und Hypothetisches („würde“): would + Grundform. Beispiel: „I would like a coffee.“ – Ich hätte gern einen Kaffee.",
  };

  // ---------- Spelling rules for regular forms ----------
  const VOWELS = "aeiou";
  const isConsonant = (ch) => !!ch && !VOWELS.includes(ch);

  function thirdPerson(v) {
    if (v.third) return v.third;
    const w = v.infinitive;
    if (/(s|sh|ch|x|z|o)$/.test(w)) return w + "es";
    if (w.endsWith("y") && isConsonant(w.at(-2))) return w.slice(0, -1) + "ies";
    return w + "s";
  }

  function ingForm(v) {
    if (v.ing) return v.ing;
    const w = v.infinitive;
    if (w.endsWith("ie")) return w.slice(0, -2) + "ying";
    if (w.endsWith("e") && !/(ee|ye|oe)$/.test(w)) return w.slice(0, -1) + "ing";
    return w + "ing";
  }

  function regularPast(v) {
    if (v.past) return v.past;
    const w = v.infinitive;
    if (w.endsWith("e")) return w + "d";
    if (w.endsWith("y") && isConsonant(w.at(-2))) return w.slice(0, -1) + "ied";
    return w + "ed";
  }

  // ---------- Verbs ----------
  // Irregular: past (2. Form) and participle (3. Form) listed. third/ing only
  // where the spelling rule above would get it wrong.
  const IRREGULAR_VERBS = [
    { infinitive: "be", de: "sein", past: "was", participle: "been", ing: "being" },
    { infinitive: "have", de: "haben", past: "had", participle: "had", third: "has" },
    { infinitive: "do", de: "tun, machen", past: "did", participle: "done" },
    { infinitive: "go", de: "gehen, fahren", past: "went", participle: "gone" },
    { infinitive: "get", de: "bekommen, werden", past: "got", participle: "got", ing: "getting" },
    { infinitive: "make", de: "machen, herstellen", past: "made", participle: "made" },
    { infinitive: "take", de: "nehmen", past: "took", participle: "taken" },
    { infinitive: "come", de: "kommen", past: "came", participle: "come" },
    { infinitive: "see", de: "sehen", past: "saw", participle: "seen" },
    { infinitive: "know", de: "wissen, kennen", past: "knew", participle: "known" },
    { infinitive: "think", de: "denken, glauben", past: "thought", participle: "thought" },
    { infinitive: "give", de: "geben", past: "gave", participle: "given" },
    { infinitive: "find", de: "finden", past: "found", participle: "found" },
    { infinitive: "tell", de: "erzählen, sagen", past: "told", participle: "told" },
    { infinitive: "say", de: "sagen", past: "said", participle: "said" },
    { infinitive: "become", de: "werden", past: "became", participle: "become" },
    { infinitive: "leave", de: "verlassen, abfahren", past: "left", participle: "left" },
    { infinitive: "feel", de: "fühlen", past: "felt", participle: "felt" },
    { infinitive: "bring", de: "bringen", past: "brought", participle: "brought" },
    { infinitive: "buy", de: "kaufen", past: "bought", participle: "bought" },
    { infinitive: "begin", de: "anfangen", past: "began", participle: "begun", ing: "beginning" },
    { infinitive: "write", de: "schreiben", past: "wrote", participle: "written" },
    { infinitive: "speak", de: "sprechen", past: "spoke", participle: "spoken" },
    { infinitive: "read", de: "lesen", past: "read", participle: "read" },
    { infinitive: "eat", de: "essen", past: "ate", participle: "eaten" },
    { infinitive: "drink", de: "trinken", past: "drank", participle: "drunk" },
    { infinitive: "sleep", de: "schlafen", past: "slept", participle: "slept" },
    { infinitive: "drive", de: "fahren (Auto)", past: "drove", participle: "driven" },
    { infinitive: "run", de: "laufen, rennen", past: "ran", participle: "run", ing: "running" },
    { infinitive: "swim", de: "schwimmen", past: "swam", participle: "swum", ing: "swimming" },
    { infinitive: "meet", de: "treffen", past: "met", participle: "met" },
    { infinitive: "pay", de: "bezahlen", past: "paid", participle: "paid" },
    { infinitive: "teach", de: "unterrichten", past: "taught", participle: "taught" },
    { infinitive: "forget", de: "vergessen", past: "forgot", participle: "forgotten", ing: "forgetting" },
  ];

  const REGULAR_VERBS = [
    { infinitive: "work", de: "arbeiten" },
    { infinitive: "live", de: "leben, wohnen" },
    { infinitive: "play", de: "spielen" },
    { infinitive: "study", de: "studieren, lernen" },
    { infinitive: "watch", de: "anschauen" },
    { infinitive: "try", de: "versuchen" },
    { infinitive: "stop", de: "aufhören, anhalten", past: "stopped", ing: "stopping" },
    { infinitive: "travel", de: "reisen", past: "travelled", ing: "travelling" },
    { infinitive: "want", de: "wollen" },
    { infinitive: "need", de: "brauchen" },
  ];

  // ---------- Building the forms ----------
  const BE = {
    simple_present: ["am", "are", "is", "are", "are", "are"],
    simple_past: ["was", "were", "was", "were", "were", "were"],
  };
  const HAVE = ["have", "have", "has", "have", "have", "have"];
  const SIX = (form) => Array(6).fill(form);

  function build(v) {
    const base = v.infinitive;
    const past = v.past || regularPast(v);
    const participle = v.participle || past;
    const ing = ingForm(v);
    const out = {
      simple_present: [base, base, thirdPerson(v), base, base, base],
      present_progressive: BE.simple_present.map((aux) => `${aux} ${ing}`),
      simple_past: SIX(past),
      present_perfect: HAVE.map((aux) => `${aux} ${participle}`),
      will_future: SIX(`will ${base}`),
      conditional: SIX(`would ${base}`),
    };
    if (base === "be") {
      out.simple_present = BE.simple_present;
      out.simple_past = BE.simple_past;
    }
    return out;
  }

  const ALL_VERBS = [
    ...IRREGULAR_VERBS.map((v) => ({ ...v, irregular: true })),
    ...REGULAR_VERBS.map((v) => ({ ...v, irregular: false, group: "regular" })),
  ];
  const FORMS = new Map(ALL_VERBS.map((v) => [v.infinitive, build(v)]));

  function getForms(verbEntry) {
    return FORMS.get(verbEntry.infinitive);
  }

  function findVerb(infinitive) {
    return ALL_VERBS.find((v) => v.infinitive === infinitive);
  }

  function regularPatternExplanation(infinitive, group, tense) {
    const v = findVerb(infinitive) || { infinitive };
    switch (tense) {
      case "simple_present":
        return `Grundform (${infinitive}); bei he/she/it mit -s: ${thirdPerson(v)}.`;
      case "present_progressive":
        return `am/is/are + -ing-Form (${ingForm(v)}).`;
      case "simple_past":
        return `Regelmäßig: Grundform + -ed (${regularPast(v)}), für alle Personen gleich.`;
      case "present_perfect":
        return `have/has + 3. Form; regelmäßig = -ed-Form (${regularPast(v)}).`;
      case "will_future":
        return "will + Grundform, für alle Personen gleich.";
      default:
        return "would + Grundform, für alle Personen gleich.";
    }
  }

  /* Short forms count as well: "'ve gone", "'s working", "'ll go", "'d like". */
  const SHORT = { am: "'m", are: "'re", is: "'s", have: "'ve", has: "'s", will: "'ll", would: "'d" };
  function alternatives(form) {
    const [aux, ...rest] = form.split(" ");
    if (!rest.length || !SHORT[aux]) return [form];
    return [form, `${SHORT[aux]} ${rest.join(" ")}`];
  }

  return {
    TENSES, TENSE_LABELS, TENSE_EXPLANATIONS, PERSON_LABELS, ALL_VERBS,
    getForms, findVerb, regularPatternExplanation, alternatives,
  };
})();
