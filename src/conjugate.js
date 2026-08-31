/* Conjugation engine: regular verbs are built by rule, irregular verbs are
   written out in full. */
const CONJUGATE = (() => {
  const TENSES = ["presente", "indefinido", "imperfecto", "futuro", "condicional", "subjuntivo"];
  const TENSE_LABELS = {
    presente: "Presente",
    indefinido: "Pretérito indefinido",
    imperfecto: "Pretérito imperfecto",
    futuro: "Futuro simple",
    condicional: "Condicional simple",
    subjuntivo: "Presente de subjuntivo",
  };
  const PERSON_LABELS = ["yo", "tú", "él/ella/usted", "nosotros/as", "vosotros/as", "ellos/ellas/ustedes"];
  const TENSE_EXPLANATIONS = {
    presente: "Für aktuelle Handlungen, Gewohnheiten und allgemeine Wahrheiten. Beispiel: „Vivo en Berlín.“ – Ich wohne in Berlin.",
    indefinido: "Für abgeschlossene Handlungen in der Vergangenheit mit klarem Zeitpunkt. Beispiel: „Ayer comí paella.“ – Gestern habe ich Paella gegessen.",
    imperfecto: "Für Gewohnheiten, Zustände und Hintergrundbeschreibungen in der Vergangenheit, ohne festen Endpunkt. Beispiel: „De niño jugaba en el parque.“ – Als Kind spielte ich im Park.",
    futuro: "Für Handlungen, die in der Zukunft passieren werden, oder Vermutungen. Beispiel: „Mañana llegaré tarde.“ – Morgen komme ich spät an.",
    condicional: "Für Höflichkeit, Wünsche und hypothetische Situationen ('würde'). Beispiel: „Me gustaría un café.“ – Ich hätte gerne einen Kaffee.",
    subjuntivo: "Für Wünsche, Zweifel, Emotionen und nach Ausdrücken wie 'que', 'ojalá', 'espero que'. Beispiel: „Espero que vengas.“ – Ich hoffe, dass du kommst.",
  };

  const REGULAR_ENDINGS = {
    ar: {
      presente: ["o", "as", "a", "amos", "áis", "an"],
      indefinido: ["é", "aste", "ó", "amos", "asteis", "aron"],
      imperfecto: ["aba", "abas", "aba", "ábamos", "abais", "aban"],
      subjuntivo: ["e", "es", "e", "emos", "éis", "en"],
    },
    er: {
      presente: ["o", "es", "e", "emos", "éis", "en"],
      indefinido: ["í", "iste", "ió", "imos", "isteis", "ieron"],
      imperfecto: ["ía", "ías", "ía", "íamos", "íais", "ían"],
      subjuntivo: ["a", "as", "a", "amos", "áis", "an"],
    },
    ir: {
      presente: ["o", "es", "e", "imos", "ís", "en"],
      indefinido: ["í", "iste", "ió", "imos", "isteis", "ieron"],
      imperfecto: ["ía", "ías", "ía", "íamos", "íais", "ían"],
      subjuntivo: ["a", "as", "a", "amos", "áis", "an"],
    },
  };
  const FUTURE_ENDINGS = ["é", "ás", "á", "emos", "éis", "án"];
  const CONDITIONAL_ENDINGS = ["ía", "ías", "ía", "íamos", "íais", "ían"];

  const GROUP_LABELS = { ar: "-ar", er: "-er", ir: "-ir" };

  function regularPatternExplanation(infinitive, group, tense) {
    const stem = infinitive.slice(0, -2);
    if (tense === "futuro") {
      return `Regelmäßig: ganzer Infinitiv (${infinitive}) + Endungen ${FUTURE_ENDINGS.map((e) => "-" + e).join(" / ")}.`;
    }
    if (tense === "condicional") {
      return `Regelmäßig: ganzer Infinitiv (${infinitive}) + Endungen ${CONDITIONAL_ENDINGS.map((e) => "-" + e).join(" / ")}.`;
    }
    const endings = REGULAR_ENDINGS[group][tense];
    return `Regelmäßiges ${GROUP_LABELS[group]}-Verb: Stamm (${stem}-) + Endungen ${endings.map((e) => "-" + e).join(" / ")}.`;
  }

  function conjugateRegular(infinitive, group) {
    const stem = infinitive.slice(0, -2);
    const e = REGULAR_ENDINGS[group];
    const out = {};
    TENSES.forEach((t) => {
      if (t === "futuro") out[t] = FUTURE_ENDINGS.map((end) => infinitive + end);
      else if (t === "condicional") out[t] = CONDITIONAL_ENDINGS.map((end) => infinitive + end);
      else out[t] = e[t].map((end) => stem + end);
    });
    return out;
  }

  // --- Irregular verbs: written out in full ---
  const IRREGULAR_VERBS = {
    ser: { de: "sein",
      presente: ["soy", "eres", "es", "somos", "sois", "son"],
      indefinido: ["fui", "fuiste", "fue", "fuimos", "fuisteis", "fueron"],
      imperfecto: ["era", "eras", "era", "éramos", "erais", "eran"],
      futuro: ["seré", "serás", "será", "seremos", "seréis", "serán"],
      condicional: ["sería", "serías", "sería", "seríamos", "seríais", "serían"],
      subjuntivo: ["sea", "seas", "sea", "seamos", "seáis", "sean"] },
    estar: { de: "sein (Zustand/Ort)",
      presente: ["estoy", "estás", "está", "estamos", "estáis", "están"],
      indefinido: ["estuve", "estuviste", "estuvo", "estuvimos", "estuvisteis", "estuvieron"],
      imperfecto: ["estaba", "estabas", "estaba", "estábamos", "estabais", "estaban"],
      futuro: ["estaré", "estarás", "estará", "estaremos", "estaréis", "estarán"],
      condicional: ["estaría", "estarías", "estaría", "estaríamos", "estaríais", "estarían"],
      subjuntivo: ["esté", "estés", "esté", "estemos", "estéis", "estén"] },
    tener: { de: "haben",
      presente: ["tengo", "tienes", "tiene", "tenemos", "tenéis", "tienen"],
      indefinido: ["tuve", "tuviste", "tuvo", "tuvimos", "tuvisteis", "tuvieron"],
      imperfecto: ["tenía", "tenías", "tenía", "teníamos", "teníais", "tenían"],
      futuro: ["tendré", "tendrás", "tendrá", "tendremos", "tendréis", "tendrán"],
      condicional: ["tendría", "tendrías", "tendría", "tendríamos", "tendríais", "tendrían"],
      subjuntivo: ["tenga", "tengas", "tenga", "tengamos", "tengáis", "tengan"] },
    hacer: { de: "machen, tun",
      presente: ["hago", "haces", "hace", "hacemos", "hacéis", "hacen"],
      indefinido: ["hice", "hiciste", "hizo", "hicimos", "hicisteis", "hicieron"],
      imperfecto: ["hacía", "hacías", "hacía", "hacíamos", "hacíais", "hacían"],
      futuro: ["haré", "harás", "hará", "haremos", "haréis", "harán"],
      condicional: ["haría", "harías", "haría", "haríamos", "haríais", "harían"],
      subjuntivo: ["haga", "hagas", "haga", "hagamos", "hagáis", "hagan"] },
    ir: { de: "gehen, fahren",
      presente: ["voy", "vas", "va", "vamos", "vais", "van"],
      indefinido: ["fui", "fuiste", "fue", "fuimos", "fuisteis", "fueron"],
      imperfecto: ["iba", "ibas", "iba", "íbamos", "ibais", "iban"],
      futuro: ["iré", "irás", "irá", "iremos", "iréis", "irán"],
      condicional: ["iría", "irías", "iría", "iríamos", "iríais", "irían"],
      subjuntivo: ["vaya", "vayas", "vaya", "vayamos", "vayáis", "vayan"] },
    poder: { de: "können",
      presente: ["puedo", "puedes", "puede", "podemos", "podéis", "pueden"],
      indefinido: ["pude", "pudiste", "pudo", "pudimos", "pudisteis", "pudieron"],
      imperfecto: ["podía", "podías", "podía", "podíamos", "podíais", "podían"],
      futuro: ["podré", "podrás", "podrá", "podremos", "podréis", "podrán"],
      condicional: ["podría", "podrías", "podría", "podríamos", "podríais", "podrían"],
      subjuntivo: ["pueda", "puedas", "pueda", "podamos", "podáis", "puedan"] },
    querer: { de: "wollen, lieben",
      presente: ["quiero", "quieres", "quiere", "queremos", "queréis", "quieren"],
      indefinido: ["quise", "quisiste", "quiso", "quisimos", "quisisteis", "quisieron"],
      imperfecto: ["quería", "querías", "quería", "queríamos", "queríais", "querían"],
      futuro: ["querré", "querrás", "querrá", "querremos", "querréis", "querrán"],
      condicional: ["querría", "querrías", "querría", "querríamos", "querríais", "querrían"],
      subjuntivo: ["quiera", "quieras", "quiera", "queramos", "queráis", "quieran"] },
    saber: { de: "wissen",
      presente: ["sé", "sabes", "sabe", "sabemos", "sabéis", "saben"],
      indefinido: ["supe", "supiste", "supo", "supimos", "supisteis", "supieron"],
      imperfecto: ["sabía", "sabías", "sabía", "sabíamos", "sabíais", "sabían"],
      futuro: ["sabré", "sabrás", "sabrá", "sabremos", "sabréis", "sabrán"],
      condicional: ["sabría", "sabrías", "sabría", "sabríamos", "sabríais", "sabrían"],
      subjuntivo: ["sepa", "sepas", "sepa", "sepamos", "sepáis", "sepan"] },
    decir: { de: "sagen",
      presente: ["digo", "dices", "dice", "decimos", "decís", "dicen"],
      indefinido: ["dije", "dijiste", "dijo", "dijimos", "dijisteis", "dijeron"],
      imperfecto: ["decía", "decías", "decía", "decíamos", "decíais", "decían"],
      futuro: ["diré", "dirás", "dirá", "diremos", "diréis", "dirán"],
      condicional: ["diría", "dirías", "diría", "diríamos", "diríais", "dirían"],
      subjuntivo: ["diga", "digas", "diga", "digamos", "digáis", "digan"] },
    venir: { de: "kommen",
      presente: ["vengo", "vienes", "viene", "venimos", "venís", "vienen"],
      indefinido: ["vine", "viniste", "vino", "vinimos", "vinisteis", "vinieron"],
      imperfecto: ["venía", "venías", "venía", "veníamos", "veníais", "venían"],
      futuro: ["vendré", "vendrás", "vendrá", "vendremos", "vendréis", "vendrán"],
      condicional: ["vendría", "vendrías", "vendría", "vendríamos", "vendríais", "vendrían"],
      subjuntivo: ["venga", "vengas", "venga", "vengamos", "vengáis", "vengan"] },
    dar: { de: "geben",
      presente: ["doy", "das", "da", "damos", "dais", "dan"],
      indefinido: ["di", "diste", "dio", "dimos", "disteis", "dieron"],
      imperfecto: ["daba", "dabas", "daba", "dábamos", "dabais", "daban"],
      futuro: ["daré", "darás", "dará", "daremos", "daréis", "darán"],
      condicional: ["daría", "darías", "daría", "daríamos", "daríais", "darían"],
      subjuntivo: ["dé", "des", "dé", "demos", "deis", "den"] },
    ver: { de: "sehen",
      presente: ["veo", "ves", "ve", "vemos", "veis", "ven"],
      indefinido: ["vi", "viste", "vio", "vimos", "visteis", "vieron"],
      imperfecto: ["veía", "veías", "veía", "veíamos", "veíais", "veían"],
      futuro: ["veré", "verás", "verá", "veremos", "veréis", "verán"],
      condicional: ["vería", "verías", "vería", "veríamos", "veríais", "verían"],
      subjuntivo: ["vea", "veas", "vea", "veamos", "veáis", "vean"] },
    poner: { de: "legen, stellen, setzen",
      presente: ["pongo", "pones", "pone", "ponemos", "ponéis", "ponen"],
      indefinido: ["puse", "pusiste", "puso", "pusimos", "pusisteis", "pusieron"],
      imperfecto: ["ponía", "ponías", "ponía", "poníamos", "poníais", "ponían"],
      futuro: ["pondré", "pondrás", "pondrá", "pondremos", "pondréis", "pondrán"],
      condicional: ["pondría", "pondrías", "pondría", "pondríamos", "pondríais", "pondrían"],
      subjuntivo: ["ponga", "pongas", "ponga", "pongamos", "pongáis", "pongan"] },
    salir: { de: "hinausgehen, ausgehen",
      presente: ["salgo", "sales", "sale", "salimos", "salís", "salen"],
      indefinido: ["salí", "saliste", "salió", "salimos", "salisteis", "salieron"],
      imperfecto: ["salía", "salías", "salía", "salíamos", "salíais", "salían"],
      futuro: ["saldré", "saldrás", "saldrá", "saldremos", "saldréis", "saldrán"],
      condicional: ["saldría", "saldrías", "saldría", "saldríamos", "saldríais", "saldrían"],
      subjuntivo: ["salga", "salgas", "salga", "salgamos", "salgáis", "salgan"] },
    traer: { de: "bringen",
      presente: ["traigo", "traes", "trae", "traemos", "traéis", "traen"],
      indefinido: ["traje", "trajiste", "trajo", "trajimos", "trajisteis", "trajeron"],
      imperfecto: ["traía", "traías", "traía", "traíamos", "traíais", "traían"],
      futuro: ["traeré", "traerás", "traerá", "traeremos", "traeréis", "traerán"],
      condicional: ["traería", "traerías", "traería", "traeríamos", "traeríais", "traerían"],
      subjuntivo: ["traiga", "traigas", "traiga", "traigamos", "traigáis", "traigan"] },
    oír: { de: "hören",
      presente: ["oigo", "oyes", "oye", "oímos", "oís", "oyen"],
      indefinido: ["oí", "oíste", "oyó", "oímos", "oísteis", "oyeron"],
      imperfecto: ["oía", "oías", "oía", "oíamos", "oíais", "oían"],
      futuro: ["oiré", "oirás", "oirá", "oiremos", "oiréis", "oirán"],
      condicional: ["oiría", "oirías", "oiría", "oiríamos", "oiríais", "oirían"],
      subjuntivo: ["oiga", "oigas", "oiga", "oigamos", "oigáis", "oigan"] },
    jugar: { de: "spielen",
      presente: ["juego", "juegas", "juega", "jugamos", "jugáis", "juegan"],
      indefinido: ["jugué", "jugaste", "jugó", "jugamos", "jugasteis", "jugaron"],
      imperfecto: ["jugaba", "jugabas", "jugaba", "jugábamos", "jugabais", "jugaban"],
      futuro: ["jugaré", "jugarás", "jugará", "jugaremos", "jugaréis", "jugarán"],
      condicional: ["jugaría", "jugarías", "jugaría", "jugaríamos", "jugaríais", "jugarían"],
      subjuntivo: ["juegue", "juegues", "juegue", "juguemos", "juguéis", "jueguen"] },
    pensar: { de: "denken",
      presente: ["pienso", "piensas", "piensa", "pensamos", "pensáis", "piensan"],
      indefinido: ["pensé", "pensaste", "pensó", "pensamos", "pensasteis", "pensaron"],
      imperfecto: ["pensaba", "pensabas", "pensaba", "pensábamos", "pensabais", "pensaban"],
      futuro: ["pensaré", "pensarás", "pensará", "pensaremos", "pensaréis", "pensarán"],
      condicional: ["pensaría", "pensarías", "pensaría", "pensaríamos", "pensaríais", "pensarían"],
      subjuntivo: ["piense", "pienses", "piense", "pensemos", "penséis", "piensen"] },
    volver: { de: "zurückkommen",
      presente: ["vuelvo", "vuelves", "vuelve", "volvemos", "volvéis", "vuelven"],
      indefinido: ["volví", "volviste", "volvió", "volvimos", "volvisteis", "volvieron"],
      imperfecto: ["volvía", "volvías", "volvía", "volvíamos", "volvíais", "volvían"],
      futuro: ["volveré", "volverás", "volverá", "volveremos", "volveréis", "volverán"],
      condicional: ["volvería", "volverías", "volvería", "volveríamos", "volveríais", "volverían"],
      subjuntivo: ["vuelva", "vuelvas", "vuelva", "volvamos", "volváis", "vuelvan"] },
    dormir: { de: "schlafen",
      presente: ["duermo", "duermes", "duerme", "dormimos", "dormís", "duermen"],
      indefinido: ["dormí", "dormiste", "durmió", "dormimos", "dormisteis", "durmieron"],
      imperfecto: ["dormía", "dormías", "dormía", "dormíamos", "dormíais", "dormían"],
      futuro: ["dormiré", "dormirás", "dormirá", "dormiremos", "dormiréis", "dormirán"],
      condicional: ["dormiría", "dormirías", "dormiría", "dormiríamos", "dormiríais", "dormirían"],
      subjuntivo: ["duerma", "duermas", "duerma", "durmamos", "durmáis", "duerman"] },
    pedir: { de: "bestellen, bitten",
      presente: ["pido", "pides", "pide", "pedimos", "pedís", "piden"],
      indefinido: ["pedí", "pediste", "pidió", "pedimos", "pedisteis", "pidieron"],
      imperfecto: ["pedía", "pedías", "pedía", "pedíamos", "pedíais", "pedían"],
      futuro: ["pediré", "pedirás", "pedirá", "pediremos", "pediréis", "pedirán"],
      condicional: ["pediría", "pedirías", "pediría", "pediríamos", "pediríais", "pedirían"],
      subjuntivo: ["pida", "pidas", "pida", "pidamos", "pidáis", "pidan"] },
    sentir: { de: "fühlen, spüren",
      presente: ["siento", "sientes", "siente", "sentimos", "sentís", "sienten"],
      indefinido: ["sentí", "sentiste", "sintió", "sentimos", "sentisteis", "sintieron"],
      imperfecto: ["sentía", "sentías", "sentía", "sentíamos", "sentíais", "sentían"],
      futuro: ["sentiré", "sentirás", "sentirá", "sentiremos", "sentiréis", "sentirán"],
      condicional: ["sentiría", "sentirías", "sentiría", "sentiríamos", "sentiríais", "sentirían"],
      subjuntivo: ["sienta", "sientas", "sienta", "sintamos", "sintáis", "sientan"] },
    empezar: { de: "anfangen, beginnen",
      presente: ["empiezo", "empiezas", "empieza", "empezamos", "empezáis", "empiezan"],
      indefinido: ["empecé", "empezaste", "empezó", "empezamos", "empezasteis", "empezaron"],
      imperfecto: ["empezaba", "empezabas", "empezaba", "empezábamos", "empezabais", "empezaban"],
      futuro: ["empezaré", "empezarás", "empezará", "empezaremos", "empezaréis", "empezarán"],
      condicional: ["empezaría", "empezarías", "empezaría", "empezaríamos", "empezaríais", "empezarían"],
      subjuntivo: ["empiece", "empieces", "empiece", "empecemos", "empecéis", "empiecen"] },
    contar: { de: "zählen, erzählen",
      presente: ["cuento", "cuentas", "cuenta", "contamos", "contáis", "cuentan"],
      indefinido: ["conté", "contaste", "contó", "contamos", "contasteis", "contaron"],
      imperfecto: ["contaba", "contabas", "contaba", "contábamos", "contabais", "contaban"],
      futuro: ["contaré", "contarás", "contará", "contaremos", "contaréis", "contarán"],
      condicional: ["contaría", "contarías", "contaría", "contaríamos", "contaríais", "contarían"],
      subjuntivo: ["cuente", "cuentes", "cuente", "contemos", "contéis", "cuenten"] },
    seguir: { de: "folgen, weitermachen",
      presente: ["sigo", "sigues", "sigue", "seguimos", "seguís", "siguen"],
      indefinido: ["seguí", "seguiste", "siguió", "seguimos", "seguisteis", "siguieron"],
      imperfecto: ["seguía", "seguías", "seguía", "seguíamos", "seguíais", "seguían"],
      futuro: ["seguiré", "seguirás", "seguirá", "seguiremos", "seguiréis", "seguirán"],
      condicional: ["seguiría", "seguirías", "seguiría", "seguiríamos", "seguiríais", "seguirían"],
      subjuntivo: ["siga", "sigas", "siga", "sigamos", "sigáis", "sigan"] },
    conocer: { de: "kennen",
      presente: ["conozco", "conoces", "conoce", "conocemos", "conocéis", "conocen"],
      indefinido: ["conocí", "conociste", "conoció", "conocimos", "conocisteis", "conocieron"],
      imperfecto: ["conocía", "conocías", "conocía", "conocíamos", "conocíais", "conocían"],
      futuro: ["conoceré", "conocerás", "conocerá", "conoceremos", "conoceréis", "conocerán"],
      condicional: ["conocería", "conocerías", "conocería", "conoceríamos", "conoceríais", "conocerían"],
      subjuntivo: ["conozca", "conozcas", "conozca", "conozcamos", "conozcáis", "conozcan"] },
  };

  const REGULAR_VERBS = [
    { infinitive: "hablar", group: "ar", de: "sprechen" },
    { infinitive: "trabajar", group: "ar", de: "arbeiten" },
    { infinitive: "estudiar", group: "ar", de: "studieren" },
    { infinitive: "comprar", group: "ar", de: "kaufen" },
    { infinitive: "viajar", group: "ar", de: "reisen" },
    { infinitive: "cocinar", group: "ar", de: "kochen" },
    { infinitive: "caminar", group: "ar", de: "gehen, laufen" },
    { infinitive: "limpiar", group: "ar", de: "putzen" },
    { infinitive: "lavar", group: "ar", de: "waschen" },
    { infinitive: "escuchar", group: "ar", de: "zuhören" },
    { infinitive: "esperar", group: "ar", de: "warten, hoffen" },
    { infinitive: "comer", group: "er", de: "essen" },
    { infinitive: "aprender", group: "er", de: "lernen" },
    { infinitive: "beber", group: "er", de: "trinken" },
    { infinitive: "correr", group: "er", de: "laufen, rennen" },
    { infinitive: "vivir", group: "ir", de: "leben, wohnen" },
    { infinitive: "escribir", group: "ir", de: "schreiben" },
    { infinitive: "abrir", group: "ir", de: "öffnen" },
  ];

  const ALL_VERBS = [
    ...Object.keys(IRREGULAR_VERBS).map((inf) => ({ infinitive: inf, de: IRREGULAR_VERBS[inf].de, irregular: true })),
    ...REGULAR_VERBS.map((v) => ({ infinitive: v.infinitive, de: v.de, irregular: false, group: v.group })),
  ];

  function getForms(verbEntry) {
    if (verbEntry.irregular) return IRREGULAR_VERBS[verbEntry.infinitive];
    return conjugateRegular(verbEntry.infinitive, verbEntry.group);
  }

  function findVerb(infinitive) {
    return ALL_VERBS.find((v) => v.infinitive === infinitive);
  }

  return { TENSES, TENSE_LABELS, TENSE_EXPLANATIONS, PERSON_LABELS, ALL_VERBS, getForms, findVerb, regularPatternExplanation };
})();
