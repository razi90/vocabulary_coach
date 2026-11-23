/* The course path for Spanish: levels, units in order, and the explanations
   for each unit's grammar topic or tense.

   A unit's words are the deck entries of its level whose topic is listed,
   in deck order; part: [k, n] takes the k-th of n equal slices. Every deck
   word belongs to exactly one unit (web/test/content.test.js checks it).
   focus points at a GRAMMAR category or a CONJUGATE tense. */
const COURSE_PATH = (() => {
  const LEVELS = {
    A1: { title: "Grundlagen", goal: "Du verstehst und benutzt einfache Sätze über dich und deinen Alltag." },
    A2: { title: "Alltag", goal: "Du erzählst von früher, kaufst ein, beschreibst Menschen und Orte." },
    B1: { title: "Selbstständig", goal: "Du sprichst über Pläne, Wünsche und Meinungen und kommst unterwegs allein zurecht." },
  };

  const UNITS = [
    { id: "a1-intro", level: "A1", title: "Sich vorstellen", goal: "Du sagst, wer du bist, woher du kommst und was du machst.",
      topics: ["Menschen", "Pronomen", "Berufe", "Arbeit", "Redemittel"],
      vocab: ["hola", "llamarse", "ser", "encantado", "el estudiante", "el profesor", "estar", "aquí", "con", "el hermano", "allí", "los padres", "el padre", "el hombre", "alto", "simpático", "la familia", "la abuela"], focus: { kind: "grammar", id: "ser_estar" },
      lesson: {
        dialogue: {
          title: "Auf einer Party", scene: "Lucía und Tom lernen sich auf einer Party in Madrid kennen.",
          lines: [
            { who: "Lucía", t: "¡Hola! Me llamo Lucía. ¿Y tú?", de: "Hallo! Ich heiße Lucía. Und du?" },
            { who: "Tom", t: "Hola, soy Tom. Soy de Alemania.", de: "Hallo, ich bin Tom. Ich komme aus Deutschland." },
            { who: "Lucía", t: "¡Encantada! ¿Eres estudiante?", de: "Freut mich! Bist du Student?" },
            { who: "Tom", t: "No, soy profesor. ¿Y tú?", de: "Nein, ich bin Lehrer. Und du?" },
            { who: "Lucía", t: "Yo soy estudiante. Estoy aquí con mi hermano.", de: "Ich bin Studentin. Ich bin mit meinem Bruder hier." },
            { who: "Tom", t: "¿Dónde está tu hermano?", de: "Wo ist dein Bruder?" },
            { who: "Lucía", t: "Está allí, con mis padres. Mi padre es el hombre alto.", de: "Er ist dort, bei meinen Eltern. Mein Vater ist der große Mann." },
            { who: "Tom", t: "¡Qué familia tan simpática!", de: "Was für eine nette Familie!" },
            { who: "Lucía", t: "Gracias. ¿Y tu familia? ¿Está en Alemania?", de: "Danke. Und deine Familie? Ist sie in Deutschland?" },
            { who: "Tom", t: "Sí, mis padres y mi abuela están en Berlín.", de: "Ja, meine Eltern und meine Oma sind in Berlin." },
          ],
          questions: [
            { prompt: "¿De dónde es Tom?", options: ["De Alemania", "De España", "De México"], answer: "De Alemania" },
            { prompt: "¿Qué es Tom?", options: ["Profesor", "Estudiante", "Médico"], answer: "Profesor" },
            { prompt: "¿Con quién está Lucía en la fiesta?", options: ["Con su hermano y sus padres", "Con su abuela", "Con sus amigos"], answer: "Con su hermano y sus padres" },
            { prompt: "¿Dónde está la abuela de Tom?", options: ["En Berlín", "En Madrid", "En la fiesta"], answer: "En Berlín" },
          ],
        },
        sentences: [
          { de: "Mein Bruder ist Student.", t: "Mi hermano es estudiante." },
          { de: "Meine Eltern sind in Madrid.", t: "Mis padres están en Madrid." },
          { de: "Wir kommen aus Deutschland.", t: "Somos de Alemania.", alt: ["Nosotros somos de Alemania."] },
          { de: "Er ist mein Freund.", t: "Es mi amigo.", alt: ["Él es mi amigo."] },
          { de: "Wo ist deine Mutter?", t: "¿Dónde está tu madre?" },
          { de: "Das Kind ist bei seinem Großvater.", t: "El niño está con su abuelo." },
          { de: "Ich bin Lehrer.", t: "Soy profesor.", alt: ["Yo soy profesor.", "Soy profesora.", "Yo soy profesora."] },
        ],
        task: {
          kind: "speak", title: "Stell dich vor",
          prompt: "Stell dich vor: Wie heißt du, woher kommst du, was machst du? Erzähl kurz von deiner Familie.",
          phrases: ["Me llamo …", "Soy de …", "Soy profesor / estudiante …", "Tengo un hermano / una hermana.", "Mis padres están en …"],
          model: "Hola, me llamo Anna. Soy de Alemania, de Hamburgo. Soy profesora. Tengo un hermano y una hermana. Mis padres están en Hamburgo.",
        },
      },
    },
    { id: "a1-numbers", level: "A1", title: "Zählen und fragen", goal: "Du zählst, nennst Preise und stellst einfache Fragen.",
      topics: ["Zahlen", "Fragewörter", "Konjunktionen"],
      vocab: ["buenos días", "cuánto", "costar", "la manzana", "dos", "el euro", "el kilo", "la naranja", "tres", "uno", "por favor", "algo", "gracias", "ocho", "diez", "el cambio", "hasta luego", "el mercado", "comprar", "la fruta"], focus: { kind: "grammar", id: "question_words" },
      lesson: {
        dialogue: {
          title: "Auf dem Markt", scene: "Eine Kundin kauft Obst an einem Marktstand.",
          lines: [
            { who: "Clienta", t: "Buenos días. ¿Cuánto cuestan las manzanas?", de: "Guten Tag. Wie viel kosten die Äpfel?" },
            { who: "Vendedor", t: "Dos euros el kilo.", de: "Zwei Euro das Kilo." },
            { who: "Clienta", t: "¿Y las naranjas?", de: "Und die Orangen?" },
            { who: "Vendedor", t: "Tres euros. Son de Valencia.", de: "Drei Euro. Sie sind aus Valencia." },
            { who: "Clienta", t: "Pues un kilo de manzanas y dos kilos de naranjas, por favor.", de: "Dann ein Kilo Äpfel und zwei Kilo Orangen, bitte." },
            { who: "Vendedor", t: "Muy bien. ¿Algo más?", de: "Sehr gut. Sonst noch etwas?" },
            { who: "Clienta", t: "No, gracias. ¿Cuánto es?", de: "Nein, danke. Was macht das?" },
            { who: "Vendedor", t: "Son ocho euros.", de: "Das macht acht Euro." },
            { who: "Clienta", t: "Aquí tiene diez.", de: "Hier sind zehn." },
            { who: "Vendedor", t: "Y dos de cambio. ¡Gracias y hasta luego!", de: "Und zwei zurück. Danke und bis später!" },
          ],
          questions: [
            { prompt: "¿Cuánto cuesta un kilo de manzanas?", options: ["Dos euros", "Tres euros", "Ocho euros"], answer: "Dos euros" },
            { prompt: "¿De dónde son las naranjas?", options: ["De Valencia", "De Madrid", "De Sevilla"], answer: "De Valencia" },
            { prompt: "¿Cuántos kilos de naranjas compra la clienta?", options: ["Dos", "Uno", "Tres"], answer: "Dos" },
            { prompt: "¿Cuánto recibe la clienta de cambio?", options: ["Dos euros", "Ocho euros", "Diez euros"], answer: "Dos euros" },
          ],
        },
        sentences: [
          { de: "Wie viel kostet das Brot?", t: "¿Cuánto cuesta el pan?" },
          { de: "Wo wohnst du?", t: "¿Dónde vives?" },
          { de: "Ich habe zwei Brüder.", t: "Tengo dos hermanos." },
          { de: "Wie viele Personen kommen?", t: "¿Cuántas personas vienen?" },
          { de: "Warum lernst du Spanisch?", t: "¿Por qué estudias español?", alt: ["¿Por qué aprendes español?"] },
          { de: "Woher kommst du?", t: "¿De dónde eres?", alt: ["¿De dónde vienes?"] },
          { de: "Wann fängt der Unterricht an?", t: "¿Cuándo empieza la clase?" },
        ],
        task: {
          kind: "write", title: "Fragen auf dem Markt",
          prompt: "Du stehst an einem Marktstand. Schreib vier Fragen an den Verkäufer: nach Preisen, nach der Menge und woher das Obst kommt.",
          phrases: ["¿Cuánto cuesta …?", "¿Cuánto cuestan …?", "¿De dónde son …?", "¿Tiene …?", "¿Cuánto es?"],
          model: "¿Cuánto cuestan los tomates? ¿De dónde son? ¿Tiene naranjas? Un kilo, por favor. ¿Cuánto es todo?",
        },
      },
    },
    { id: "a1-verbs-1", level: "A1", title: "Was du jeden Tag tust", goal: "Du beschreibst deinen Tag mit den wichtigsten Verben.",
      topics: ["Verben"], part: [1, 2], focus: { kind: "tense", id: "presente" } },
    { id: "a1-calendar", level: "A1", title: "Tage und Uhrzeiten", goal: "Du nennst Wochentage, Monate und Uhrzeiten und verabredest dich.",
      topics: ["Kalender", "Zeit"], focus: { kind: "grammar", id: "time_expressions" } },
    { id: "a1-food", level: "A1", title: "Essen und einkaufen", goal: "Du bestellst im Café und kaufst auf dem Markt ein.",
      topics: ["Essen", "Einkaufen", "Geld"], focus: { kind: "grammar", id: "articles" } },
    { id: "a1-describe", level: "A1", title: "Dinge beschreiben", goal: "Du sagst, wie etwas aussieht und wie es ist.",
      topics: ["Adjektive", "Adverbien", "Farben"], focus: { kind: "grammar", id: "agreement" } },
    { id: "a1-home", level: "A1", title: "Zuhause und Körper", goal: "Du beschreibst deine Wohnung und sagst, was dir wehtut.",
      topics: ["Zuhause", "Körper", "Kleidung", "Gesundheit"], focus: { kind: "grammar", id: "gustar" } },
    { id: "a1-verbs-2", level: "A1", title: "Mehr Verben für den Alltag", goal: "Du sprichst über Vorlieben, Pläne und was du kannst.",
      topics: ["Verben"], part: [2, 2], focus: { kind: "grammar", id: "reflexive" } },
    { id: "a1-city", level: "A1", title: "In der Stadt", goal: "Du fragst nach dem Weg und findest dich zurecht.",
      topics: ["Stadt", "Reisen", "Präpositionen", "Technologie"], focus: { kind: "grammar", id: "hay_estar" } },
    { id: "a1-leisure", level: "A1", title: "Freizeit und Wetter", goal: "Du erzählst, was du gern machst, und sprichst über das Wetter.",
      topics: ["Freizeit", "Sport", "Wetter", "Natur", "Tiere"], focus: { kind: "grammar", id: "ir_a" } },

    { id: "a2-past", level: "A2", title: "Von gestern erzählen", goal: "Du erzählst, was du gemacht hast.",
      topics: ["Verben"], part: [1, 2], focus: { kind: "tense", id: "indefinido" } },
    { id: "a2-restaurant", level: "A2", title: "Im Restaurant", goal: "Du bestellst, fragst nach und bezahlst.",
      topics: ["Essen", "Einkaufen", "Geld"], focus: { kind: "grammar", id: "por_para" } },
    { id: "a2-people", level: "A2", title: "Menschen und Berufe", goal: "Du beschreibst Menschen, ihren Charakter und ihre Arbeit.",
      topics: ["Menschen", "Berufe", "Arbeit", "Pronomen", "Fragewörter"], focus: { kind: "grammar", id: "possessives" } },
    { id: "a2-clothes", level: "A2", title: "Kleidung und Aussehen", goal: "Du kaufst Kleidung und beschreibst, wie jemand aussieht.",
      topics: ["Kleidung", "Farben", "Adjektive"], part: [1, 2], focus: { kind: "grammar", id: "comparatives" } },
    { id: "a2-health", level: "A2", title: "Beim Arzt", goal: "Du sagst, was dir fehlt, und verstehst einfache Ratschläge.",
      topics: ["Körper", "Gesundheit"], focus: { kind: "grammar", id: "imperative" } },
    { id: "a2-childhood", level: "A2", title: "Wie es früher war", goal: "Du beschreibst Gewohnheiten und Situationen von früher.",
      topics: ["Verben"], part: [2, 2], focus: { kind: "tense", id: "imperfecto" } },
    { id: "a2-talk", level: "A2", title: "Gespräche führen", goal: "Du reagierst im Gespräch, stimmst zu und widersprichst.",
      topics: ["Redemittel", "Konjunktionen", "Adverbien"], focus: { kind: "grammar", id: "object_pronouns" } },
    { id: "a2-traits", level: "A2", title: "Eigenschaften", goal: "Du beschreibst Menschen und Dinge genauer und vergleichst sie.",
      topics: ["Kleidung", "Farben", "Adjektive"], part: [2, 2], focus: { kind: "grammar", id: "muy_mucho" } },
    { id: "a2-home", level: "A2", title: "Zuhause und Technik", goal: "Du beschreibst deine Wohnung und dein Handy genauer.",
      topics: ["Zuhause", "Technologie"], focus: { kind: "grammar", id: "perfecto" } },
    { id: "a2-dates", level: "A2", title: "Zahlen, Daten, Termine", goal: "Du nennst Daten, große Zahlen und vereinbarst Termine.",
      topics: ["Zahlen", "Kalender", "Zeit"], focus: { kind: "grammar", id: "indef_imperf" } },
    { id: "a2-travel", level: "A2", title: "Reisen", goal: "Du planst eine Reise und kommst am Bahnhof und im Hotel zurecht.",
      topics: ["Reisen", "Stadt", "Präpositionen", "Wetter"], focus: { kind: "grammar", id: "prepositions" } },
    { id: "a2-nature", level: "A2", title: "Freizeit und Natur", goal: "Du sprichst über Hobbys, Sport und Ausflüge.",
      topics: ["Freizeit", "Sport", "Natur", "Tiere"], focus: { kind: "grammar", id: "estar_gerundio" } },

    { id: "b1-plans", level: "B1", title: "Pläne machen", goal: "Du sprichst über Pläne und Vermutungen.",
      topics: ["Verben"], focus: { kind: "tense", id: "futuro" } },
    { id: "b1-opinion", level: "B1", title: "Meinung sagen", goal: "Du sagst, was du denkst, wünschst und bezweifelst.",
      topics: ["Redemittel", "Konjunktionen", "Adverbien"], focus: { kind: "tense", id: "subjuntivo" } },
    { id: "b1-work", level: "B1", title: "Im Beruf", goal: "Du sprichst über deine Arbeit und formulierst höfliche Bitten.",
      topics: ["Arbeit", "Berufe", "Technologie", "Geld", "Zahlen"], focus: { kind: "tense", id: "condicional" } },
    { id: "b1-life", level: "B1", title: "Alltag und Gesundheit", goal: "Du erklärst Gründe und Zwecke im Alltag.",
      topics: ["Gesundheit", "Körper", "Essen", "Einkaufen", "Kleidung", "Zuhause"], focus: { kind: "grammar", id: "connectors" } },
    { id: "b1-describe", level: "B1", title: "Genauer beschreiben", goal: "Du beschreibst Dinge und Lagen genau.",
      topics: ["Adjektive", "Farben", "Präpositionen"], focus: { kind: "grammar", id: "relatives" } },
    { id: "b1-world", level: "B1", title: "Unterwegs und Umwelt", goal: "Du sprichst über Reisen, Städte und die Umwelt.",
      topics: ["Reisen", "Stadt", "Natur", "Wetter", "Menschen", "Zeit"], focus: { kind: "grammar", id: "se_impersonal" } },
  ];

  const GUIDES = {
    "grammar:ser_estar": {
      title: "Ser oder estar",
      body: [
        "Beide heißen „sein“. Ser sagt, was etwas ist: Identität, Herkunft, Beruf, Charakter, Uhrzeit. Estar sagt, wie oder wo etwas gerade ist: Ort, Befinden, Zustand.",
        "Eine Faustregel: Passt „gerade“ oder „im Moment“ in den Satz, ist es meist estar.",
        "Vorsicht beim Ort: Wo sich etwas befindet, sagt estar. Wo eine Veranstaltung stattfindet, sagt ser.",
      ],
      examples: [
        { t: "Soy profesora.", de: "Ich bin Lehrerin.", note: "Beruf → ser" },
        { t: "Somos de Alemania.", de: "Wir kommen aus Deutschland.", note: "Herkunft → ser" },
        { t: "Estoy cansado.", de: "Ich bin müde.", note: "Zustand → estar" },
        { t: "El banco está en la plaza.", de: "Die Bank ist am Platz.", note: "Ort → estar" },
        { t: "La fiesta es en mi casa.", de: "Die Party ist bei mir.", note: "Veranstaltung → ser" },
      ],
    },
    "grammar:por_para": {
      title: "Por oder para",
      body: [
        "Beide heißen oft „für“. Para schaut nach vorn: Zweck, Ziel, Empfänger, Frist. Por schaut auf den Grund oder den Weg: Ursache, Tausch, Dauer, „durch“.",
        "Frag dich: Wozu? Für wen? Bis wann? Dann para. Warum? Wodurch? Im Tausch wofür? Dann por.",
      ],
      examples: [
        { t: "Este regalo es para ti.", de: "Dieses Geschenk ist für dich.", note: "Empfänger → para" },
        { t: "Trabajo para ganar dinero.", de: "Ich arbeite, um Geld zu verdienen.", note: "Zweck → para" },
        { t: "Gracias por tu ayuda.", de: "Danke für deine Hilfe.", note: "Grund → por" },
        { t: "Pagué diez euros por el libro.", de: "Ich habe zehn Euro für das Buch bezahlt.", note: "Tausch → por" },
        { t: "Paseamos por el parque.", de: "Wir spazieren durch den Park.", note: "durch → por" },
      ],
    },
    "grammar:articles": {
      title: "Artikel und Genus",
      body: [
        "Jedes Nomen ist männlich oder weiblich: el und un für männlich, la und una für weiblich, im Plural los und las.",
        "Wörter auf -o sind meist männlich, auf -a meist weiblich. Ausnahmen gibt es viele, etwa el día oder la mano. Lerne jedes Nomen deshalb mit seinem Artikel.",
        "Weibliche Nomen, die mit betontem a- beginnen, nehmen im Singular el: el agua, aber las aguas. Das Adjektiv bleibt weiblich: el agua fría.",
      ],
      examples: [
        { t: "el libro, la casa", de: "das Buch, das Haus" },
        { t: "el día", de: "der Tag", note: "endet auf -a, ist aber männlich" },
        { t: "la mano", de: "die Hand", note: "endet auf -o, ist aber weiblich" },
        { t: "el agua fría", de: "das kalte Wasser", note: "betontes a- → el" },
        { t: "las flores rojas", de: "die roten Blumen" },
      ],
    },
    "grammar:prepositions": {
      title: "Verb + Präposition",
      body: [
        "Viele Verben verlangen eine feste Präposition. Sie folgt oft nicht dem Deutschen, deshalb lernst du sie mit dem Verb zusammen.",
        "Steht eine Person als Objekt, kommt außerdem ein a davor: Veo a María.",
      ],
      examples: [
        { t: "Pienso en ti.", de: "Ich denke an dich.", note: "pensar en" },
        { t: "Sueño con el mar.", de: "Ich träume vom Meer.", note: "soñar con" },
        { t: "Depende del tiempo.", de: "Es hängt vom Wetter ab.", note: "depender de" },
        { t: "Se casó con Ana.", de: "Er hat Ana geheiratet.", note: "casarse con" },
        { t: "Empiezo a entender.", de: "Ich fange an zu verstehen.", note: "empezar a + Infinitiv" },
      ],
    },
    "tense:presente": {
      title: "Das Presente",
      body: [
        "Das Presente sagt, was jetzt geschieht, was regelmäßig passiert und oft auch, was bald passiert.",
        "Regelmäßige Verben: die Endung -ar, -er oder -ir abtrennen und anhängen. Bei -ar: -o, -as, -a, -amos, -áis, -an. Bei -er: -o, -es, -e, -emos, -éis, -en. Bei -ir: -o, -es, -e, -imos, -ís, -en.",
        "Das Pronomen fällt meist weg: „Hablo español“ reicht, die Endung zeigt die Person.",
        "Viele häufige Verben ändern den Stamm (querer → quiero, poder → puedo) oder sind ganz unregelmäßig (ser, ir, tener).",
      ],
      examples: [
        { t: "Hablo alemán y un poco de español.", de: "Ich spreche Deutsch und ein bisschen Spanisch." },
        { t: "Comemos a las dos.", de: "Wir essen um zwei." },
        { t: "¿Vives en Berlín?", de: "Wohnst du in Berlin?" },
        { t: "Quiero un café.", de: "Ich möchte einen Kaffee.", note: "querer: e → ie" },
        { t: "Mañana voy al médico.", de: "Morgen gehe ich zum Arzt.", note: "nahe Zukunft" },
      ],
    },
    "tense:indefinido": {
      title: "Das Indefinido",
      body: [
        "Das Indefinido erzählt abgeschlossene Ereignisse: was einmal passiert ist, oft mit einer Zeitangabe wie ayer, el lunes oder en 2020.",
        "Regelmäßig bei -ar: -é, -aste, -ó, -amos, -asteis, -aron. Bei -er und -ir: -í, -iste, -ió, -imos, -isteis, -ieron.",
        "Wichtige unregelmäßige Verben: ser und ir haben dieselben Formen (fui, fuiste, fue …), tener → tuve, hacer → hice, estar → estuve.",
      ],
      examples: [
        { t: "Ayer hablé con mi madre.", de: "Gestern habe ich mit meiner Mutter gesprochen." },
        { t: "El año pasado fuimos a México.", de: "Letztes Jahr sind wir nach Mexiko gefahren.", note: "ir → fuimos" },
        { t: "¿Qué hiciste el sábado?", de: "Was hast du am Samstag gemacht?", note: "hacer → hiciste" },
        { t: "El tren llegó tarde.", de: "Der Zug kam zu spät." },
      ],
    },
    "tense:imperfecto": {
      title: "Das Imperfecto",
      body: [
        "Das Imperfecto beschreibt die Vergangenheit von innen: Gewohnheiten (früher immer), Hintergrund und Zustände (es war kalt, ich war müde).",
        "Das Indefinido erzählt, was passierte. Das Imperfecto erzählt, wie es war. In „Leía cuando sonó el teléfono“ ist leía der Hintergrund und sonó das Ereignis.",
        "Regelmäßig bei -ar: -aba, -abas, -aba, -ábamos, -abais, -aban. Bei -er und -ir: -ía, -ías, -ía, -íamos, -íais, -ían. Nur drei Verben sind unregelmäßig: ser (era), ir (iba), ver (veía).",
      ],
      examples: [
        { t: "De niño jugaba en la calle.", de: "Als Kind habe ich auf der Straße gespielt.", note: "Gewohnheit" },
        { t: "Hacía mucho calor.", de: "Es war sehr heiß.", note: "Hintergrund" },
        { t: "Eran las diez.", de: "Es war zehn Uhr.", note: "Uhrzeit in der Vergangenheit" },
        { t: "Leía cuando sonó el teléfono.", de: "Ich las gerade, als das Telefon klingelte." },
      ],
    },
    "tense:futuro": {
      title: "Das Futuro simple",
      body: [
        "Das Futuro sagt, was sein wird, und drückt auch Vermutungen aus: „Serán las diez“ heißt „Es wird wohl zehn sein“.",
        "Die Endungen hängen am ganzen Infinitiv und sind für alle Verben gleich: -é, -ás, -á, -emos, -éis, -án.",
        "Unregelmäßig ist nur der Stamm: tener → tendr-, hacer → har-, poder → podr-, salir → saldr-.",
        "Im Gespräch sagt man oft ir a + Infinitiv: „Voy a llamar“.",
      ],
      examples: [
        { t: "Mañana lloverá.", de: "Morgen wird es regnen." },
        { t: "Te llamaré esta noche.", de: "Ich rufe dich heute Abend an." },
        { t: "Tendremos tiempo el domingo.", de: "Am Sonntag werden wir Zeit haben.", note: "tener → tendr-" },
        { t: "¿Dónde estará Juan?", de: "Wo Juan wohl ist?", note: "Vermutung" },
      ],
    },
    "tense:condicional": {
      title: "Das Condicional",
      body: [
        "Das Condicional entspricht dem deutschen „würde“: Wünsche, höfliche Bitten, Ratschläge und was unter einer Bedingung wäre.",
        "Es hat denselben Stamm wie das Futuro und die Endungen -ía, -ías, -ía, -íamos, -íais, -ían.",
      ],
      examples: [
        { t: "Me gustaría un café.", de: "Ich hätte gern einen Kaffee.", note: "höflicher Wunsch" },
        { t: "¿Podrías ayudarme?", de: "Könntest du mir helfen?", note: "höfliche Bitte" },
        { t: "Yo en tu lugar no lo haría.", de: "An deiner Stelle würde ich das nicht tun.", note: "Rat" },
        { t: "Dijo que vendría.", de: "Er sagte, er würde kommen." },
      ],
    },
    "tense:subjuntivo": {
      title: "Der Subjuntivo",
      body: [
        "Der Subjuntivo ist keine Zeit, sondern eine Aussageweise. Er steht nach Wunsch, Gefühl, Zweifel und Aufforderung, meist nach que.",
        "„Quiero que vengas“ heißt „Ich will, dass du kommst“. Bei Gewissheit bleibt der normale Indikativ: „Sé que vienes“.",
        "Bildung: Von der yo-Form des Presente das -o weg, dann die Endungen tauschen. -ar-Verben bekommen -e (hable), -er- und -ir-Verben -a (coma, viva). Aus tengo wird tenga, aus hago haga.",
        "Er steht auch nach ojalá, para que und nach cuando, wenn es um die Zukunft geht.",
      ],
      examples: [
        { t: "Espero que estés bien.", de: "Ich hoffe, dass es dir gut geht.", note: "Wunsch" },
        { t: "Ojalá haga sol mañana.", de: "Hoffentlich scheint morgen die Sonne." },
        { t: "Te lo explico para que lo entiendas.", de: "Ich erkläre es dir, damit du es verstehst." },
        { t: "No creo que sea verdad.", de: "Ich glaube nicht, dass das stimmt.", note: "Zweifel" },
        { t: "Cuando llegues, llámame.", de: "Ruf mich an, wenn du ankommst.", note: "cuando + Zukunft" },
      ],
    },
    "grammar:question_words": {
      title: "Fragewörter",
      body: [
        "Spanische Fragen haben ein umgedrehtes Fragezeichen am Anfang, und jedes Fragewort trägt einen Akzent: qué, cómo, dónde, cuándo, cuánto, quién, cuál.",
        "Qué fragt nach einer Sache, cuál nach einer Auswahl oder einer bestimmten Angabe. Vor ser steht fast immer cuál: ¿Cuál es tu dirección?",
        "Dónde fragt nach dem Ort, adónde nach der Richtung. Cuánto richtet sich nach dem Nomen: cuántos libros, cuántas horas.",
      ],
      examples: [
        { t: "¿Cómo te llamas?", de: "Wie heißt du?" },
        { t: "¿Cuál es tu dirección?", de: "Wie ist deine Adresse?", note: "bestimmte Angabe → cuál" },
        { t: "¿Adónde vamos?", de: "Wohin gehen wir?", note: "Richtung → adónde" },
        { t: "¿Cuántas horas trabajas?", de: "Wie viele Stunden arbeitest du?", note: "las horas → cuántas" },
      ],
    },
    "grammar:time_expressions": {
      title: "Uhrzeit und Datum",
      body: [
        "Die Uhrzeit sagst du mit ser und dem Artikel: es la una, son las dos, son las tres y cuarto. Gefragt wird mit ¿Qué hora es?",
        "„Um“ heißt a: a las ocho. Mit genauer Uhrzeit sagst du de la mañana oder de la tarde, ohne Uhrzeit por la mañana.",
        "Vor Wochentagen steht keine Präposition, nur der Artikel: el lunes heißt „am Montag“, los lunes „montags“. Monate und Jahre stehen mit en.",
      ],
      examples: [
        { t: "Son las tres y media.", de: "Es ist halb vier." },
        { t: "Quedamos a las ocho.", de: "Wir treffen uns um acht.", note: "um → a las" },
        { t: "El viernes voy al cine.", de: "Am Freitag gehe ich ins Kino.", note: "kein en vor Wochentagen" },
        { t: "Los domingos comemos con mis padres.", de: "Sonntags essen wir bei meinen Eltern.", note: "regelmäßig → los" },
        { t: "Nací en 1990.", de: "Ich bin 1990 geboren." },
      ],
    },
    "grammar:agreement": {
      title: "Adjektive angleichen",
      body: [
        "Im Spanischen steht das Adjektiv meist hinter dem Nomen und passt sich an: an das Geschlecht und an die Zahl.",
        "Adjektive auf -o haben vier Formen: rojo, roja, rojos, rojas. Adjektive auf -e oder auf Konsonant haben nur zwei: grande, grandes; azul, azules.",
        "Bueno und malo verlieren vor einem männlichen Nomen das -o (un buen día), grande wird vor jedem Nomen zu gran und bedeutet dann „großartig“.",
      ],
      examples: [
        { t: "un coche rojo, una casa roja", de: "ein rotes Auto, ein rotes Haus" },
        { t: "las paredes blancas", de: "die weißen Wände", note: "la pared ist weiblich" },
        { t: "un chico inteligente, una chica inteligente", de: "ein kluger Junge, ein kluges Mädchen", note: "-e bleibt gleich" },
        { t: "Hace un buen día.", de: "Es ist ein schöner Tag.", note: "bueno → buen" },
      ],
    },
    "grammar:gustar": {
      title: "Gustar und doler",
      body: [
        "„Ich mag Kaffee“ heißt wörtlich „Der Kaffee gefällt mir“: Me gusta el café. Das Gemochte ist das Subjekt, die Person steht als me, te, le, nos, os, les davor.",
        "Deshalb richtet sich das Verb nach dem Gemochten: me gusta el libro, me gustan los libros. Vor einem Infinitiv steht immer gusta.",
        "Genauso funktionieren doler (wehtun), encantar (sehr gefallen) und interesar: Me duele la cabeza.",
      ],
      examples: [
        { t: "Me gusta el café.", de: "Ich mag Kaffee." },
        { t: "Me gustan las películas de terror.", de: "Ich mag Horrorfilme.", note: "Plural → gustan" },
        { t: "¿Te gusta cocinar?", de: "Kochst du gern?", note: "Infinitiv → gusta" },
        { t: "A Pedro le duelen los pies.", de: "Pedro tun die Füße weh." },
        { t: "No me gusta. — A mí tampoco.", de: "Das mag ich nicht. – Ich auch nicht." },
      ],
    },
    "grammar:reflexive": {
      title: "Reflexive Verben",
      body: [
        "Viele Alltagsverben sind im Spanischen reflexiv: levantarse (aufstehen), ducharse, llamarse (heißen), acostarse (ins Bett gehen). Einige davon sind es im Deutschen nicht.",
        "Das Pronomen richtet sich nach der Person: me, te, se, nos, os, se. Es steht vor dem konjugierten Verb (me levanto) oder hängt an Infinitiv und Gerundio (voy a levantarme).",
        "Bei Körperteilen steht der Artikel statt des Possessivs: Me lavo las manos, nicht „lavo mis manos“.",
      ],
      examples: [
        { t: "Me llamo Clara.", de: "Ich heiße Clara." },
        { t: "Nos levantamos a las siete.", de: "Wir stehen um sieben auf." },
        { t: "¿A qué hora te acuestas?", de: "Wann gehst du ins Bett?" },
        { t: "Tengo que ducharme.", de: "Ich muss duschen.", note: "am Infinitiv angehängt" },
        { t: "Se lava los dientes.", de: "Er putzt sich die Zähne.", note: "Artikel statt Possessiv" },
      ],
    },
    "grammar:hay_estar": {
      title: "Hay oder estar",
      body: [
        "Hay heißt „es gibt“. Es stellt etwas Neues vor, das noch nicht bekannt ist: mit un, una, einer Zahl, mucho oder ganz ohne Artikel. Hay ändert sich nie.",
        "Estar sagt, wo sich etwas Bestimmtes befindet: mit el, la, mi oder einem Namen.",
        "Die Frage nach dem Weg zeigt den Unterschied: ¿Hay un banco por aquí? (Gibt es hier eine Bank?) und ¿Dónde está el banco? (Wo ist die Bank?).",
      ],
      examples: [
        { t: "Hay un café en la esquina.", de: "An der Ecke gibt es ein Café.", note: "un → hay" },
        { t: "El café está en la esquina.", de: "Das Café ist an der Ecke.", note: "el → estar" },
        { t: "Hay tres habitaciones.", de: "Es gibt drei Zimmer.", note: "Zahl → hay" },
        { t: "¿Dónde están mis gafas?", de: "Wo ist meine Brille?" },
      ],
    },
    "grammar:ir_a": {
      title: "Ir a + Infinitiv",
      body: [
        "Wenn du über Pläne sprichst, nimmst du im Alltag fast immer ir a + Infinitiv: Voy a estudiar (ich werde lernen).",
        "Nur ir wird konjugiert: voy, vas, va, vamos, vais, van. Dann folgt a und der Infinitiv.",
        "Auch für das, was gleich passiert, passt es: Va a llover (gleich regnet es).",
      ],
      examples: [
        { t: "Voy a llamar a mi madre.", de: "Ich rufe meine Mutter an.", note: "Plan" },
        { t: "¿Qué vas a hacer mañana?", de: "Was machst du morgen?" },
        { t: "Vamos a comer fuera.", de: "Wir gehen auswärts essen." },
        { t: "Cuidado, te vas a caer.", de: "Vorsicht, du fällst gleich hin.", note: "gleich passiert es" },
      ],
    },
    "grammar:possessives": {
      title: "Possessivbegleiter",
      body: [
        "Mi, tu und su richten sich nach dem, was jemand besitzt, nicht nach dem Besitzer: mi coche, mis coches.",
        "Nuestro und vuestro haben vier Formen: nuestro piso, nuestra casa, nuestros amigos, nuestras amigas.",
        "Su ist mehrdeutig: sein, ihr, Ihr. Was gemeint ist, ergibt sich aus dem Zusammenhang. Allein, etwa nach ser, stehen die langen Formen mío, tuyo, suyo.",
      ],
      examples: [
        { t: "Mis padres viven en Madrid.", de: "Meine Eltern wohnen in Madrid." },
        { t: "Nuestra hija tiene diez años.", de: "Unsere Tochter ist zehn.", note: "la hija → nuestra" },
        { t: "Marta y su hermano.", de: "Marta und ihr Bruder." },
        { t: "¿Es tuyo? — Sí, es mío.", de: "Gehört das dir? – Ja, das ist meins." },
      ],
    },
    "grammar:comparatives": {
      title: "Vergleiche",
      body: [
        "Mehr oder weniger: más … que, menos … que. „Als“ heißt que, vor Zahlen aber de: más de cien.",
        "Gleich: tan + Adjektiv + como (tan alto como), tanto + Nomen + como (tanto dinero como).",
        "Unregelmäßig: bueno → mejor, malo → peor. Beim Alter von Menschen: mayor und menor. Der Superlativ: el más caro de la ciudad.",
      ],
      examples: [
        { t: "El avión es más rápido que el tren.", de: "Das Flugzeug ist schneller als der Zug." },
        { t: "Soy tan alto como mi padre.", de: "Ich bin so groß wie mein Vater." },
        { t: "Este vino es mejor.", de: "Dieser Wein ist besser.", note: "nicht más bueno" },
        { t: "Mi hermana mayor vive en Lima.", de: "Meine ältere Schwester wohnt in Lima." },
        { t: "Es la playa más bonita de la isla.", de: "Das ist der schönste Strand der Insel." },
      ],
    },
    "grammar:imperative": {
      title: "Der Imperativ",
      body: [
        "Für tú sieht der bejahte Imperativ aus wie die 3. Person Singular des Presente: habla, come, escribe. Acht wichtige Verben sind unregelmäßig: ven, di, haz, pon, sal, sé, ten, ve.",
        "Für usted und ustedes tauschen die Endungen ihren Vokal: hable, coma. Bei vosotros wird das -r des Infinitivs zu -d: hablad.",
        "Verneint nimmst du immer die Form des Subjuntivo: no hables, no comas. Pronomen hängen am bejahten Imperativ (dímelo), stehen beim verneinten davor (no me lo digas).",
      ],
      examples: [
        { t: "Habla más despacio, por favor.", de: "Sprich bitte langsamer." },
        { t: "Pase, por favor.", de: "Kommen Sie bitte herein.", note: "usted" },
        { t: "No te preocupes.", de: "Mach dir keine Sorgen.", note: "verneint → Subjuntivo" },
        { t: "Dímelo.", de: "Sag es mir.", note: "Pronomen angehängt" },
      ],
    },
    "grammar:object_pronouns": {
      title: "Objektpronomen",
      body: [
        "Lo, la, los, las ersetzen das direkte Objekt, also wen oder was: ¿El café? Lo tomo solo. Le und les ersetzen das indirekte Objekt, also wem: Le escribo.",
        "Die Pronomen stehen vor dem konjugierten Verb. An Infinitiv, Gerundio und bejahten Imperativ werden sie angehängt: quiero verlo, dámelo.",
        "Stehen zwei zusammen, kommt das indirekte zuerst. Le und les werden dann zu se: se lo doy (ich gebe es ihm).",
      ],
      examples: [
        { t: "¿La película? La vi ayer.", de: "Den Film? Den habe ich gestern gesehen.", note: "la película → la" },
        { t: "Le doy mi número.", de: "Ich gebe ihm meine Nummer.", note: "wem → le" },
        { t: "Se lo explico.", de: "Ich erkläre es ihm.", note: "le + lo → se lo" },
        { t: "Voy a comprarlo.", de: "Ich werde es kaufen.", note: "am Infinitiv angehängt" },
      ],
    },
    "grammar:muy_mucho": {
      title: "Muy, mucho, bien, bueno",
      body: [
        "Muy heißt „sehr“ und steht vor Adjektiven und Adverbien: muy caro, muy rápido. Es ändert sich nie.",
        "Mucho heißt „viel“. Beim Verb bleibt es gleich (como mucho), vor einem Nomen passt es sich an: mucho tiempo, mucha agua, muchos libros. Deshalb: hace mucho frío, tengo mucha hambre.",
        "Bien beschreibt, wie man etwas tut (cantas bien), bueno beschreibt ein Nomen (una buena idea).",
      ],
      examples: [
        { t: "Es muy simpática.", de: "Sie ist sehr nett." },
        { t: "Te quiero mucho.", de: "Ich hab dich sehr lieb.", note: "beim Verb → mucho" },
        { t: "Tengo mucha hambre.", de: "Ich habe großen Hunger.", note: "el hambre ist weiblich" },
        { t: "Cocina muy bien.", de: "Er kocht sehr gut.", note: "wie? → bien" },
        { t: "Es una buena idea.", de: "Das ist eine gute Idee." },
      ],
    },
    "grammar:perfecto": {
      title: "Das Pretérito perfecto",
      body: [
        "Form: haber im Presente (he, has, ha, hemos, habéis, han) + Partizip. Regelmäßig endet es auf -ado (hablado) oder -ido (comido, vivido) und ändert sich nach haber nie.",
        "Wichtige unregelmäßige Partizipien: hecho, visto, dicho, escrito, puesto, vuelto, abierto, roto, muerto.",
        "In Spanien steht das Perfecto für Vergangenes in einem Zeitraum, der noch andauert (hoy, esta semana, este año) und für Erfahrungen (alguna vez, nunca, ya, todavía no). Für abgeschlossene Zeitpunkte nimmt man das Indefinido. In Lateinamerika steht dafür meist auch das Indefinido.",
      ],
      examples: [
        { t: "Hoy he comido paella.", de: "Heute habe ich Paella gegessen.", note: "hoy → Perfecto" },
        { t: "¿Has estado alguna vez en Cuba?", de: "Warst du schon einmal auf Kuba?", note: "Erfahrung" },
        { t: "Todavía no he terminado.", de: "Ich bin noch nicht fertig." },
        { t: "Ayer comí paella.", de: "Gestern habe ich Paella gegessen.", note: "ayer → Indefinido" },
      ],
    },
    "grammar:indef_imperf": {
      title: "Indefinido oder Imperfecto",
      body: [
        "Stell dir eine Erzählung als Film vor. Das Imperfecto ist die Kulisse: wie es war, was gerade lief, was man immer tat. Das Indefinido ist die Handlung: was passierte.",
        "Signale fürs Imperfecto: siempre, antes, de niño, todos los días, mientras. Signale fürs Indefinido: ayer, el lunes, en 2015, de repente, una vez.",
        "Unterbricht ein Ereignis eine Situation, stehen beide nebeneinander: Dormía cuando sonó el despertador.",
      ],
      examples: [
        { t: "Hacía sol y paseábamos por la playa.", de: "Die Sonne schien, und wir gingen am Strand spazieren.", note: "Kulisse" },
        { t: "De repente empezó a llover.", de: "Plötzlich fing es an zu regnen.", note: "Ereignis" },
        { t: "Dormía cuando sonó el despertador.", de: "Ich schlief, als der Wecker klingelte." },
        { t: "De niña leía mucho.", de: "Als Kind habe ich viel gelesen.", note: "Gewohnheit" },
      ],
    },
    "grammar:estar_gerundio": {
      title: "Estar + Gerundio",
      body: [
        "Was in diesem Moment passiert, sagst du mit estar + Gerundio: Estoy trabajando (ich arbeite gerade).",
        "Das Gerundio: -ar wird zu -ando (hablando), -er und -ir zu -iendo (comiendo, viviendo). Steht ein Vokal davor, schreibt man -yendo (leyendo, oyendo).",
        "Einige -ir-Verben ändern den Stamm: dormir → durmiendo, pedir → pidiendo, decir → diciendo.",
      ],
      examples: [
        { t: "¿Qué estás haciendo?", de: "Was machst du gerade?" },
        { t: "Estoy hablando por teléfono.", de: "Ich telefoniere gerade." },
        { t: "Los niños están durmiendo.", de: "Die Kinder schlafen gerade.", note: "o → u" },
        { t: "Está lloviendo.", de: "Es regnet gerade." },
      ],
    },
    "grammar:relatives": {
      title: "Relativsätze",
      body: [
        "Que verbindet fast alles: el libro que leo, la mujer que trabaja aquí. Anders als im Deutschen ändert es sich nicht.",
        "Nach einer Präposition steht el que, la que, los que, las que, bei Personen auch quien: la persona con la que hablé.",
        "Donde steht für Orte, lo que bedeutet „das, was“: No sé lo que quieres.",
      ],
      examples: [
        { t: "La película que vimos era larga.", de: "Der Film, den wir gesehen haben, war lang." },
        { t: "El pueblo donde vivo es tranquilo.", de: "Das Dorf, in dem ich wohne, ist ruhig." },
        { t: "Es la persona con quien trabajo.", de: "Das ist die Person, mit der ich arbeite." },
        { t: "Haz lo que quieras.", de: "Mach, was du willst." },
      ],
    },
    "grammar:connectors": {
      title: "Satzverbinder",
      body: [
        "Mit wenigen Wörtern verbindest du Sätze zu einer Begründung: porque (weil), como (da, am Satzanfang), por eso (deshalb), así que (also).",
        "Gegensätze: pero (aber), sino (sondern, nach einer Verneinung), aunque (obwohl), sin embargo (trotzdem, jedoch).",
        "Für einen Zweck steht para + Infinitiv: Ahorro para viajar.",
      ],
      examples: [
        { t: "Como hacía frío, nos quedamos en casa.", de: "Da es kalt war, blieben wir zu Hause.", note: "Grund am Anfang → como" },
        { t: "No es caro, sino barato.", de: "Es ist nicht teuer, sondern billig.", note: "sino nach Verneinung" },
        { t: "Aunque estoy cansado, voy a salir.", de: "Obwohl ich müde bin, gehe ich aus." },
        { t: "Perdí el tren, así que llegué tarde.", de: "Ich habe den Zug verpasst, also kam ich zu spät." },
      ],
    },
    "grammar:se_impersonal": {
      title: "Unpersönliches se",
      body: [
        "Wo im Deutschen „man“ steht, nimmt das Spanische oft se + Verb in der 3. Person: Aquí se come bien (hier isst man gut).",
        "Steht ein Nomen im Plural dabei, geht das Verb mit: Se vende piso, aber Se venden pisos. Vor einem Infinitiv bleibt es Singular: Se puede pagar con tarjeta.",
        "Du findest es auf Schildern, in Rezepten und in Anleitungen.",
      ],
      examples: [
        { t: "Aquí se habla español.", de: "Hier spricht man Spanisch." },
        { t: "Se venden coches usados.", de: "Gebrauchtwagen zu verkaufen.", note: "Plural → venden" },
        { t: "¿Se puede pagar con tarjeta?", de: "Kann man mit Karte zahlen?" },
        { t: "¿Cómo se escribe tu nombre?", de: "Wie schreibt man deinen Namen?" },
      ],
    },

  };

  return { LEVELS, UNITS, GUIDES };
})();
