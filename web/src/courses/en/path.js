/* The course path for English - see courses/es/path.js for the rules. */
const COURSE_PATH = (() => {
  const LEVELS = {
    A1: { title: "Grundlagen", goal: "Du verstehst und benutzt einfache Sätze über dich und deinen Alltag." },
    A2: { title: "Alltag", goal: "Du erzählst von Erlebtem, kaufst ein, beschreibst Menschen und Orte." },
    B1: { title: "Selbstständig", goal: "Du sprichst über Pläne und Meinungen und kommst im Beruf und unterwegs allein zurecht." },
  };

  const UNITS = [
    { id: "a1-intro", level: "A1", title: "Sich vorstellen", goal: "Du sagst, wer du bist, woher du kommst und was du machst.",
      topics: ["Menschen", "Berufe", "Arbeit", "Redemittel"],
      vocab: ["hi", "new", "first", "day", "name", "nice to meet you", "where", "from", "brother", "to live", "to work", "really", "doctor", "engineer", "team", "boss", "coffee", "to love"], focus: { kind: "tense", id: "simple_present" },
      lesson: {
        dialogue: {
          title: "Der erste Arbeitstag", scene: "Jonas fängt in einer Firma in London an. In der Küche trifft er Sarah.",
          lines: [
            { who: "Sarah", t: "Hi, I'm Sarah. Are you new here?", de: "Hallo, ich bin Sarah. Bist du neu hier?" },
            { who: "Jonas", t: "Yes, it's my first day. My name is Jonas.", de: "Ja, heute ist mein erster Tag. Ich heiße Jonas." },
            { who: "Sarah", t: "Nice to meet you, Jonas. Where are you from?", de: "Schön, dich kennenzulernen, Jonas. Woher kommst du?" },
            { who: "Jonas", t: "I'm from Germany, from Cologne.", de: "Ich komme aus Deutschland, aus Köln." },
            { who: "Sarah", t: "Oh, my brother lives in Germany. He works in Munich.", de: "Oh, mein Bruder wohnt in Deutschland. Er arbeitet in München." },
            { who: "Jonas", t: "Really? What does he do?", de: "Wirklich? Was macht er beruflich?" },
            { who: "Sarah", t: "He's a doctor. And what do you do here?", de: "Er ist Arzt. Und was machst du hier?" },
            { who: "Jonas", t: "I'm an engineer. I work in Tom's team.", de: "Ich bin Ingenieur. Ich arbeite in Toms Team." },
            { who: "Sarah", t: "Great, Tom is my boss too. Do you like coffee?", de: "Super, Tom ist auch mein Chef. Trinkst du gern Kaffee?" },
            { who: "Jonas", t: "Yes, I love coffee.", de: "Ja, ich liebe Kaffee." },
          ],
          questions: [
            { prompt: "Where is Jonas from?", options: ["From Cologne", "From Munich", "From London"], answer: "From Cologne" },
            { prompt: "What does Sarah's brother do?", options: ["He's a doctor.", "He's an engineer.", "He's a teacher."], answer: "He's a doctor." },
            { prompt: "Where does Sarah's brother work?", options: ["In Munich", "In Cologne", "In London"], answer: "In Munich" },
            { prompt: "Who is Sarah's boss?", options: ["Tom", "Jonas", "Her brother"], answer: "Tom" },
          ],
        },
        sentences: [
          { de: "Ich wohne in Berlin.", t: "I live in Berlin." },
          { de: "Er arbeitet in einem Krankenhaus.", t: "He works in a hospital.", alt: ["He works at a hospital."] },
          { de: "Sie ist Lehrerin.", t: "She's a teacher.", alt: ["She is a teacher."] },
          { de: "Woher kommst du?", t: "Where are you from?", alt: ["Where do you come from?"] },
          { de: "Was machst du beruflich?", t: "What do you do?", alt: ["What do you do for a living?", "What's your job?", "What is your job?"] },
          { de: "Meine Schwester spricht kein Englisch.", t: "My sister doesn't speak English.", alt: ["My sister does not speak English."] },
          { de: "Schön, dich kennenzulernen.", t: "Nice to meet you.", alt: ["Pleased to meet you."] },
        ],
        task: {
          kind: "speak", title: "Stell dich vor",
          prompt: "Stell dich auf Englisch vor: Name, Herkunft, Beruf, wo du wohnst und was du gern machst.",
          phrases: ["My name is …", "I'm from …", "I'm a … / I work as a …", "I live in …", "I like …"],
          model: "Hi, my name is Anna. I'm from Germany. I'm a nurse and I work in a hospital in Hamburg. I live with my husband and our two children. I like cooking and running.",
        },
      },
    },
    { id: "a1-numbers", level: "A1", title: "Zählen und fragen", goal: "Du zählst, nennst Preise und stellst einfache Fragen.",
      topics: ["Zahlen", "Fragewörter", "Konjunktionen"], focus: { kind: "grammar", id: "questions_do" } },
    { id: "a1-verbs-1", level: "A1", title: "Was du jeden Tag tust", goal: "Du beschreibst deinen Tag und was gerade passiert.",
      topics: ["Verben"], part: [1, 2], focus: { kind: "grammar", id: "simple_progressive" } },
    { id: "a1-calendar", level: "A1", title: "Tage und Uhrzeiten", goal: "Du nennst Wochentage, Monate und Uhrzeiten und verabredest dich.",
      topics: ["Kalender", "Zeit"], focus: { kind: "grammar", id: "prepositions" } },
    { id: "a1-food", level: "A1", title: "Essen und einkaufen", goal: "Du bestellst im Café und kaufst im Laden ein.",
      topics: ["Essen", "Einkaufen", "Geld"], focus: { kind: "grammar", id: "some_any" } },
    { id: "a1-describe", level: "A1", title: "Dinge beschreiben", goal: "Du sagst, wie etwas aussieht und wie es ist.",
      topics: ["Adjektive", "Farben", "Adverbien"], part: [1, 2], focus: { kind: "grammar", id: "articles" } },
    { id: "a1-home", level: "A1", title: "Zuhause und Körper", goal: "Du beschreibst deine Wohnung, deine Kleidung und sagst, was dir wehtut.",
      topics: ["Zuhause", "Körper", "Kleidung", "Gesundheit"], focus: { kind: "grammar", id: "possessives" } },
    { id: "a1-verbs-2", level: "A1", title: "Mehr Verben für den Alltag", goal: "Du sprichst über Vorlieben und was du gerade tust.",
      topics: ["Verben"], part: [2, 2], focus: { kind: "tense", id: "present_progressive" } },
    { id: "a1-how", level: "A1", title: "Wie und wie oft", goal: "Du sagst, wie oft und wie gut du etwas tust.",
      topics: ["Adjektive", "Farben", "Adverbien"], part: [2, 2], focus: { kind: "grammar", id: "adverbs_adjectives" } },
    { id: "a1-city", level: "A1", title: "In der Stadt", goal: "Du fragst nach dem Weg und findest dich zurecht.",
      topics: ["Stadt", "Reisen", "Präpositionen", "Technologie", "Falsche Freunde"], focus: { kind: "grammar", id: "there_is" } },
    { id: "a1-leisure", level: "A1", title: "Freizeit und Wetter", goal: "Du erzählst, was du gern machst, und sprichst über das Wetter.",
      topics: ["Freizeit", "Sport", "Wetter", "Natur", "Tiere"], focus: { kind: "grammar", id: "can_ability" } },

    { id: "a2-past", level: "A2", title: "Von gestern erzählen", goal: "Du erzählst, was du gemacht hast.",
      topics: ["Verben"], focus: { kind: "tense", id: "simple_past" } },
    { id: "a2-people", level: "A2", title: "Menschen und Arbeit", goal: "Du erzählst von Menschen, ihrem Leben und ihrer Arbeit.",
      topics: ["Menschen", "Berufe", "Arbeit", "Fragewörter"], focus: { kind: "grammar", id: "perfect_past" } },
    { id: "a2-shopping", level: "A2", title: "Einkaufen und Essen", goal: "Du kaufst Kleidung und Lebensmittel und fragst nach Größen und Preisen.",
      topics: ["Essen", "Einkaufen", "Geld", "Kleidung"], focus: { kind: "grammar", id: "much_many" } },
    { id: "a2-health", level: "A2", title: "Beim Arzt", goal: "Du sagst, was dir fehlt und seit wann.",
      topics: ["Gesundheit", "Körper"], focus: { kind: "grammar", id: "since_for" } },
    { id: "a2-describe", level: "A2", title: "Eigenschaften", goal: "Du beschreibst Menschen und Dinge genauer und vergleichst sie.",
      topics: ["Adjektive"], focus: { kind: "grammar", id: "comparatives" } },
    { id: "a2-travel", level: "A2", title: "Reisen", goal: "Du erzählst von Reisen und kommst am Bahnhof und im Hotel zurecht.",
      topics: ["Reisen", "Stadt", "Präpositionen", "Wetter"], focus: { kind: "tense", id: "present_perfect" } },
    { id: "a2-talk", level: "A2", title: "Gespräche führen", goal: "Du reagierst im Gespräch, stimmst zu und widersprichst.",
      topics: ["Adverbien", "Konjunktionen", "Redemittel"], focus: { kind: "grammar", id: "must_have_to" } },
    { id: "a2-false-friends", level: "A2", title: "Falsche Freunde", goal: "Du erkennst Wörter, die deutsch klingen, aber etwas anderes heißen.",
      topics: ["Falsche Freunde", "Technologie", "Zahlen", "Zeit"], focus: { kind: "grammar", id: "false_friends" } },
    { id: "a2-leisure", level: "A2", title: "Freizeit und Zuhause", goal: "Du sprichst über Hobbys, Sport und dein Zuhause.",
      topics: ["Freizeit", "Sport", "Natur", "Tiere", "Zuhause"], focus: { kind: "grammar", id: "gerund_infinitive" } },

    { id: "b1-plans", level: "B1", title: "Pläne machen", goal: "Du sprichst über Pläne, Vorhersagen und Versprechen.",
      topics: ["Verben"], focus: { kind: "tense", id: "will_future" } },
    { id: "b1-work", level: "B1", title: "Im Beruf", goal: "Du sprichst über deine Arbeit und was passiert, wenn …",
      topics: ["Arbeit", "Berufe", "Technologie", "Geld", "Zahlen"], focus: { kind: "grammar", id: "conditionals" } },
    { id: "b1-opinion", level: "B1", title: "Meinung sagen", goal: "Du sagst höflich, was du denkst und was du tun würdest.",
      topics: ["Redemittel", "Konjunktionen", "Adverbien"], focus: { kind: "tense", id: "conditional" } },
    { id: "b1-false-friends", level: "B1", title: "Mehr falsche Freunde", goal: "Du vermeidest die Wörter, die Deutschsprachige am häufigsten verwechseln.",
      topics: ["Falsche Freunde"], focus: { kind: "grammar", id: "false_friends" } },
    { id: "b1-travel", level: "B1", title: "Unterwegs", goal: "Du kommst auf Reisen auch mit Problemen allein zurecht.",
      topics: ["Reisen", "Stadt", "Präpositionen", "Wetter", "Natur", "Zeit"], focus: { kind: "grammar", id: "passive" } },
    { id: "b1-describe", level: "B1", title: "Genauer beschreiben", goal: "Du beschreibst Menschen, ihr Aussehen und ihren Charakter genau.",
      topics: ["Adjektive", "Menschen", "Kleidung"], focus: { kind: "grammar", id: "relatives" } },
    { id: "b1-life", level: "B1", title: "Alltag und Gesundheit", goal: "Du sprichst über Gewohnheiten, Gesundheit und Haushalt.",
      topics: ["Zuhause", "Gesundheit", "Essen", "Einkaufen", "Freizeit", "Sport"], focus: { kind: "grammar", id: "used_to" } },
  ];

  const GUIDES = {
    "grammar:simple_progressive": {
      title: "Simple oder Progressive",
      body: [
        "Das Deutsche hat eine Gegenwart, das Englische zwei. Das Simple Present steht für Gewohnheiten und Fakten, das Present Progressive für das, was gerade oder nur vorübergehend passiert.",
        "Signalwörter helfen: always, usually, every day zeigen das Simple. now, at the moment, today, this week zeigen das Progressive.",
        "Verben für Zustände wie know, like, want, need oder believe stehen fast nie in der -ing-Form.",
      ],
      examples: [
        { t: "She drinks coffee every morning.", de: "Sie trinkt jeden Morgen Kaffee.", note: "Gewohnheit → Simple" },
        { t: "Look, it's raining!", de: "Schau, es regnet!", note: "gerade jetzt → Progressive" },
        { t: "I'm staying with friends this week.", de: "Diese Woche wohne ich bei Freunden.", note: "vorübergehend" },
        { t: "I understand you.", de: "Ich verstehe dich.", note: "nicht: I'm understanding" },
      ],
    },
    "grammar:perfect_past": {
      title: "Present Perfect oder Simple Past",
      body: [
        "„Ich habe gegessen“ ist im Englischen nicht automatisch „I have eaten“. Entscheidend ist der Zeitpunkt.",
        "Steht ein Zeitpunkt in der Vergangenheit da (yesterday, last week, in 2019, two days ago), nimmst du das Simple Past.",
        "Ohne Zeitpunkt, mit Bezug zur Gegenwart oder mit ever, never, already, yet, just, since und for nimmst du das Present Perfect.",
      ],
      examples: [
        { t: "I saw that film last week.", de: "Ich habe den Film letzte Woche gesehen.", note: "Zeitpunkt → Simple Past" },
        { t: "I've seen that film.", de: "Ich habe den Film schon gesehen.", note: "wann, ist egal → Present Perfect" },
        { t: "Have you ever been to London?", de: "Warst du schon einmal in London?" },
        { t: "She left two hours ago.", de: "Sie ist vor zwei Stunden gegangen." },
        { t: "We've just arrived.", de: "Wir sind gerade angekommen." },
      ],
    },
    "grammar:since_for": {
      title: "since oder for",
      body: [
        "„Seit“ hat im Englischen zwei Wörter: since vor einem Zeitpunkt, for vor einer Zeitspanne.",
        "Dazu gehört meist das Present Perfect, nicht das Präsens wie im Deutschen. „Ich wohne hier seit zehn Jahren“ heißt „I've lived here for ten years“.",
      ],
      examples: [
        { t: "I've known her since 2015.", de: "Ich kenne sie seit 2015.", note: "Zeitpunkt → since" },
        { t: "I've known her for ten years.", de: "Ich kenne sie seit zehn Jahren.", note: "Zeitspanne → for" },
        { t: "She's been ill since Monday.", de: "Sie ist seit Montag krank." },
        { t: "We've been waiting for two hours.", de: "Wir warten seit zwei Stunden." },
      ],
    },
    "grammar:some_any": {
      title: "some oder any",
      body: [
        "Beide heißen „etwas“ oder „einige“. some steht in bejahten Sätzen, any in Fragen und verneinten Sätzen.",
        "Bei Angeboten und Bitten steht trotzdem some, weil man ein Ja erwartet.",
        "not any lässt sich durch no ersetzen: „I haven't got any time“ ist dasselbe wie „I've got no time“.",
      ],
      examples: [
        { t: "There are some apples in the fridge.", de: "Es sind ein paar Äpfel im Kühlschrank." },
        { t: "Are there any apples left?", de: "Sind noch Äpfel übrig?", note: "Frage → any" },
        { t: "I don't have any money.", de: "Ich habe kein Geld.", note: "verneint → any" },
        { t: "Would you like some cake?", de: "Möchtest du ein Stück Kuchen?", note: "Angebot → some" },
      ],
    },
    "grammar:prepositions": {
      title: "in, on, at",
      body: [
        "Bei der Zeit: at für Uhrzeiten und feste Zeitpunkte (at six, at night), on für Tage und Daten (on Monday, on 3 May), in für Monate, Jahre und Tageszeiten (in July, in 2020, in the morning).",
        "Beim Ort: at für Punkte und Treffpunkte (at the station, at work), on für Flächen (on the table, on the wall), in für Räume und Städte (in the kitchen, in Berlin).",
      ],
      examples: [
        { t: "The film starts at eight.", de: "Der Film fängt um acht an.", note: "Uhrzeit → at" },
        { t: "See you on Friday.", de: "Bis Freitag.", note: "Tag → on" },
        { t: "I was born in 1990.", de: "Ich bin 1990 geboren.", note: "Jahr → in" },
        { t: "We met at the station.", de: "Wir haben uns am Bahnhof getroffen.", note: "Treffpunkt → at" },
        { t: "The keys are on the table.", de: "Die Schlüssel liegen auf dem Tisch.", note: "Fläche → on" },
      ],
    },
    "grammar:false_friends": {
      title: "Falsche Freunde",
      body: [
        "Manche englischen Wörter sehen aus wie deutsche, heißen aber etwas anderes. Sie fallen nicht auf, weil sie sich richtig anfühlen.",
        "Lerne sie als Paar: was das englische Wort heißt, und wie man das deutsche Wort wirklich sagt.",
      ],
      examples: [
        { t: "I want to become a doctor.", de: "Ich möchte Ärztin werden.", note: "become = werden; bekommen = get" },
        { t: "the current situation", de: "die aktuelle Lage", note: "aktuell = current; actual = tatsächlich" },
        { t: "Eventually he said yes.", de: "Schließlich sagte er ja.", note: "eventually = schließlich; eventuell = maybe" },
        { t: "a birthday gift", de: "ein Geburtstagsgeschenk", note: "gift = Geschenk; Gift = poison" },
        { t: "My boss is nice.", de: "Mein Chef ist nett.", note: "Chef = boss; chef = Koch" },
      ],
    },
    "grammar:gerund_infinitive": {
      title: "-ing oder to + Grundform",
      body: [
        "Nach manchen Verben folgt die -ing-Form, nach anderen to + Grundform. Eine einzige Regel gibt es nicht, aber Gruppen, die du dir merken kannst.",
        "-ing nach enjoy, finish, mind, avoid, suggest, keep und nach jeder Präposition (interested in learning, before leaving).",
        "to + Grundform nach want, decide, hope, plan, learn, need und would like.",
        "Bei stop ändert sich die Bedeutung: stop smoking heißt aufhören zu rauchen, stop to smoke anhalten, um zu rauchen.",
      ],
      examples: [
        { t: "I enjoy cooking.", de: "Ich koche gern.", note: "enjoy + -ing" },
        { t: "She decided to stay.", de: "Sie beschloss zu bleiben.", note: "decide + to" },
        { t: "Do you mind waiting?", de: "Macht es dir etwas aus zu warten?" },
        { t: "He's good at swimming.", de: "Er kann gut schwimmen.", note: "nach Präposition → -ing" },
      ],
    },
    "grammar:conditionals": {
      title: "if-Sätze",
      body: [
        "Wirklich möglich: if + Present, im Hauptsatz will. Im if-Teil steht nie will.",
        "Gedacht oder unwahrscheinlich: if + Past, im Hauptsatz would. Bei to be oft were: „If I were you …“",
        "Vergangen und nicht mehr änderbar: if + Past Perfect, im Hauptsatz would have.",
      ],
      examples: [
        { t: "If it rains, we'll stay at home.", de: "Wenn es regnet, bleiben wir zu Hause.", note: "möglich" },
        { t: "If I had more time, I would travel more.", de: "Wenn ich mehr Zeit hätte, würde ich mehr reisen.", note: "gedacht" },
        { t: "If I were you, I'd ask her.", de: "An deiner Stelle würde ich sie fragen." },
        { t: "If we had left earlier, we would have caught the train.", de: "Wären wir früher losgefahren, hätten wir den Zug bekommen.", note: "vorbei" },
      ],
    },
    "tense:simple_present": {
      title: "Das Simple Present",
      body: [
        "Das Simple Present steht für Gewohnheiten, Fakten und Zustände.",
        "Bei he, she und it kommt ein -s dazu: she works, he goes, it rains. Das ist der häufigste Fehler.",
        "Fragen und Verneinung bildest du mit do oder does. Nach does steht das Verb ohne -s: „Does she like tea?“",
      ],
      examples: [
        { t: "I live in Hamburg.", de: "Ich wohne in Hamburg." },
        { t: "He works in a hospital.", de: "Er arbeitet in einem Krankenhaus.", note: "he → -s" },
        { t: "Do you speak English?", de: "Sprichst du Englisch?" },
        { t: "She doesn't eat meat.", de: "Sie isst kein Fleisch.", note: "doesn't + Grundform" },
      ],
    },
    "tense:present_progressive": {
      title: "Das Present Progressive",
      body: [
        "Form: am, is oder are + Verb mit -ing: I'm reading, she's working.",
        "Es steht für das, was gerade passiert, was nur vorübergehend ist, und für feste Verabredungen.",
        "Schreibweise: Ein stummes e fällt weg (make → making). Nach kurzem betontem Vokal wird der Konsonant verdoppelt (run → running).",
      ],
      examples: [
        { t: "I'm reading a good book.", de: "Ich lese gerade ein gutes Buch." },
        { t: "They're living in Spain this year.", de: "Dieses Jahr wohnen sie in Spanien.", note: "vorübergehend" },
        { t: "I'm meeting Tom tonight.", de: "Ich treffe Tom heute Abend.", note: "Verabredung" },
      ],
    },
    "tense:simple_past": {
      title: "Das Simple Past",
      body: [
        "Das Simple Past erzählt Abgeschlossenes, meist mit Zeitpunkt: yesterday, last year, in 2010, ago.",
        "Regelmäßige Verben bekommen -ed: worked, played, stopped. Viele häufige Verben sind unregelmäßig (go → went, see → saw, have → had); die lernst du einzeln.",
        "Fragen und Verneinung mit did und der Grundform: „Did you see it?“, „I didn't go.“",
      ],
      examples: [
        { t: "I called her yesterday.", de: "Ich habe sie gestern angerufen." },
        { t: "We went to Italy last summer.", de: "Letzten Sommer sind wir nach Italien gefahren.", note: "go → went" },
        { t: "Did you sleep well?", de: "Hast du gut geschlafen?", note: "did + Grundform" },
      ],
    },
    "tense:present_perfect": {
      title: "Das Present Perfect",
      body: [
        "Form: have oder has + dritte Verbform: I have finished, she has gone.",
        "Es steht für Erfahrungen und Ergebnisse ohne genannten Zeitpunkt und für alles, was bis jetzt andauert (mit since und for).",
        "Mit einem Zeitpunkt in der Vergangenheit geht es nicht. „I have seen him yesterday“ ist falsch, richtig ist „I saw him yesterday“.",
      ],
      examples: [
        { t: "I've lost my keys.", de: "Ich habe meine Schlüssel verloren.", note: "Ergebnis: sie sind jetzt weg" },
        { t: "Have you ever eaten sushi?", de: "Hast du schon einmal Sushi gegessen?", note: "Erfahrung" },
        { t: "She has lived here for years.", de: "Sie wohnt seit Jahren hier.", note: "dauert an" },
      ],
    },
    "tense:will_future": {
      title: "Das will-Future",
      body: [
        "will + Grundform, für alle Personen gleich, kurz I'll, she'll.",
        "Es steht für Vorhersagen, spontane Entschlüsse und Versprechen. Für feste Pläne nimmt man eher going to oder das Progressive.",
        "Nach if und when steht kein will, auch wenn es um die Zukunft geht: „When I arrive, I'll call you.“",
      ],
      examples: [
        { t: "It will be cold tomorrow.", de: "Morgen wird es kalt.", note: "Vorhersage" },
        { t: "I'll help you.", de: "Ich helfe dir.", note: "spontan, Angebot" },
        { t: "When I arrive, I'll call you.", de: "Wenn ich ankomme, rufe ich dich an.", note: "kein will nach when" },
      ],
    },
    "tense:conditional": {
      title: "Das Conditional mit would",
      body: [
        "would + Grundform, für alle Personen gleich, kurz I'd.",
        "Es steht für höfliche Wünsche, Ratschläge und Gedachtes.",
        "Im if-Teil steht kein would: „If I had time“, nicht „If I would have time“.",
      ],
      examples: [
        { t: "I'd like a coffee, please.", de: "Ich hätte gern einen Kaffee.", note: "höflicher Wunsch" },
        { t: "I would ask her.", de: "Ich würde sie fragen.", note: "Rat" },
        { t: "It would be nice to see you.", de: "Es wäre schön, dich zu sehen." },
      ],
    },
    "grammar:questions_do": {
      title: "Fragen mit do und does",
      body: [
        "Im Deutschen stellt man das Verb nach vorn: „Spielst du Gitarre?“ Im Englischen braucht die Frage im Simple Present ein Hilfsverb: Do you play the guitar?",
        "Bei he, she und it heißt es does. Das Verb steht dann in der Grundform, das -s wandert ins does: Does she play?",
        "Verneinung genauso: I don't know, he doesn't know. Be, can, will und must brauchen kein do: Are you ready? Can you help?",
      ],
      examples: [
        { t: "Do you live here?", de: "Wohnst du hier?" },
        { t: "What does he do?", de: "Was macht er beruflich?", note: "does + Grundform do" },
        { t: "She doesn't like fish.", de: "Sie mag keinen Fisch." },
        { t: "Is it far?", de: "Ist es weit?", note: "be ohne do" },
      ],
    },
    "grammar:articles": {
      title: "a, an, the",
      body: [
        "A und an heißen „ein“. Welches du nimmst, hängt vom Klang ab: a car, an apple, aber an hour (stummes h) und a university (klingt wie „ju“).",
        "Anders als im Deutschen steht a vor Berufen: I'm a teacher. Ohne Artikel stehen dagegen allgemein Gemeintes im Plural (I like dogs), Unzählbares (Love is …), Mahlzeiten und feste Orte wie go to work, go to bed.",
        "The steht, wenn klar ist, welches Ding gemeint ist: Close the window.",
      ],
      examples: [
        { t: "I'm an engineer.", de: "Ich bin Ingenieur.", note: "Beruf → a/an" },
        { t: "It takes an hour.", de: "Es dauert eine Stunde.", note: "stummes h → an" },
        { t: "I love music.", de: "Ich liebe Musik.", note: "allgemein → ohne Artikel" },
        { t: "The music is too loud.", de: "Die Musik ist zu laut.", note: "diese Musik → the" },
      ],
    },
    "grammar:possessives": {
      title: "my, mine und 's",
      body: [
        "Vor einem Nomen stehen my, your, his, her, its, our, their. Ohne Nomen danach stehen mine, yours, his, hers, ours, theirs: It's mine.",
        "Bei Personen zeigt 's den Besitz: Anna's car, my brother's flat. Endet der Plural auf -s, kommt nur der Apostroph: my parents' house.",
        "Its (sein, bei Dingen) hat nie einen Apostroph. It's ist immer it is.",
      ],
      examples: [
        { t: "Is this your phone? — No, it's hers.", de: "Ist das dein Handy? – Nein, ihres." },
        { t: "my sister's boyfriend", de: "der Freund meiner Schwester" },
        { t: "the teachers' room", de: "das Lehrerzimmer", note: "Plural → nur Apostroph" },
        { t: "The company changed its name.", de: "Die Firma hat ihren Namen geändert.", note: "its ohne Apostroph" },
      ],
    },
    "grammar:adverbs_adjectives": {
      title: "Adjektiv oder Adverb",
      body: [
        "Im Deutschen heißt beides „gut“: ein gutes Essen, er kocht gut. Im Englischen beschreibt das Adjektiv ein Nomen (a good cook), das Adverb ein Verb (he cooks well).",
        "Adverbien bilden sich meist mit -ly: quick → quickly, careful → carefully. Ausnahmen: good → well, fast und hard bleiben gleich. Nach be, look, feel, taste und sound steht das Adjektiv.",
        "Häufigkeitswörter wie always, often, never stehen vor dem Hauptverb (I often go), aber nach be (I'm often late).",
      ],
      examples: [
        { t: "She's a slow reader. She reads slowly.", de: "Sie liest langsam." },
        { t: "You did it well.", de: "Du hast es gut gemacht.", note: "good → well" },
        { t: "This smells good.", de: "Das riecht gut.", note: "nach smell → Adjektiv" },
        { t: "We usually eat at seven.", de: "Wir essen normalerweise um sieben.", note: "vor dem Verb" },
      ],
    },
    "grammar:there_is": {
      title: "there is und there are",
      body: [
        "„Es gibt“ heißt there is vor einem Nomen im Singular oder Unzählbarem und there are vor dem Plural. In der Vergangenheit: there was, there were.",
        "It is verwendest du für etwas, das schon bekannt ist, für Wetter, Zeit und Entfernung: It's late. It's raining.",
        "Deutsches „es gibt“ wird also nie zu „it gives“.",
      ],
      examples: [
        { t: "There's a pharmacy round the corner.", de: "Um die Ecke gibt es eine Apotheke." },
        { t: "There are no tickets left.", de: "Es gibt keine Karten mehr.", note: "Plural → are" },
        { t: "Is there any coffee?", de: "Gibt es noch Kaffee?" },
        { t: "It's five kilometres to the station.", de: "Bis zum Bahnhof sind es fünf Kilometer.", note: "Entfernung → it" },
      ],
    },
    "grammar:can_ability": {
      title: "can, could, be able to",
      body: [
        "Can heißt „können“ und „dürfen“. Es ist für alle Personen gleich (she can), braucht kein to und kein do: Can you …? I can't.",
        "Could ist die Vergangenheit (I could swim when I was six) und die höfliche Bitte (Could you help me?).",
        "Can hat keine anderen Zeiten. Dafür nimmst du be able to: I'll be able to, I've been able to.",
      ],
      examples: [
        { t: "Can you drive?", de: "Kannst du Auto fahren?" },
        { t: "He can't come today.", de: "Er kann heute nicht kommen." },
        { t: "Could you open the door, please?", de: "Könntest du bitte die Tür aufmachen?", note: "höflich" },
        { t: "I won't be able to call you.", de: "Ich werde dich nicht anrufen können." },
      ],
    },
    "grammar:much_many": {
      title: "much, many, a lot of",
      body: [
        "Im Deutschen heißt beides „viel“. Im Englischen kommt es darauf an, ob man das Nomen zählen kann: many cars, many people, aber much money, much time.",
        "In bejahten Sätzen sagt man meist a lot of, egal ob zählbar oder nicht: a lot of cars, a lot of money. Much und many stehen vor allem in Fragen und Verneinungen.",
        "Für „ein paar“ und „ein bisschen“ gilt dasselbe: a few books, a little milk.",
      ],
      examples: [
        { t: "How many people are coming?", de: "Wie viele Leute kommen?" },
        { t: "We don't have much time.", de: "Wir haben nicht viel Zeit." },
        { t: "There's a lot of traffic.", de: "Es ist viel Verkehr.", note: "bejaht → a lot of" },
        { t: "Just a little milk, please.", de: "Nur ein bisschen Milch, bitte." },
      ],
    },
    "grammar:comparatives": {
      title: "Vergleiche",
      body: [
        "Kurze Adjektive (eine Silbe, oder zwei auf -y) bekommen -er und -est: cheap, cheaper, the cheapest; easy, easier, the easiest. Nach kurzem Vokal wird der Konsonant verdoppelt: big, bigger.",
        "Längere Adjektive bilden den Vergleich mit more und most: more interesting, the most interesting.",
        "„Als“ heißt than, „so … wie“ heißt as … as. Unregelmäßig: good, better, best; bad, worse, worst; far, further, furthest.",
      ],
      examples: [
        { t: "Berlin is bigger than Munich.", de: "Berlin ist größer als München." },
        { t: "This is more comfortable.", de: "Das ist bequemer.", note: "lang → more" },
        { t: "She's as tall as her mother.", de: "Sie ist so groß wie ihre Mutter." },
        { t: "It was the best day of my life.", de: "Es war der schönste Tag meines Lebens." },
      ],
    },
    "grammar:must_have_to": {
      title: "must, have to, should",
      body: [
        "Must und have to heißen beide „müssen“. Must hat nur diese eine Form; für Vergangenheit und Zukunft nimmst du had to und will have to.",
        "Achtung bei der Verneinung: „Du musst nicht“ heißt you don't have to. You mustn't heißt „du darfst nicht“.",
        "Should heißt „sollte“ und gibt einen Rat: You should see a doctor.",
      ],
      examples: [
        { t: "I have to go now.", de: "Ich muss jetzt los." },
        { t: "You mustn't park here.", de: "Hier darfst du nicht parken.", note: "Verbot" },
        { t: "You don't have to bring anything.", de: "Du musst nichts mitbringen.", note: "keine Pflicht" },
        { t: "You should try the fish.", de: "Du solltest den Fisch probieren." },
      ],
    },
    "grammar:relatives": {
      title: "who, which, that, whose",
      body: [
        "Who steht für Personen, which für Dinge und Tiere. That geht für beides, aber nicht in Einschüben mit Kommas.",
        "Whose heißt „dessen“ oder „deren“, where steht für Orte. What ist kein Relativpronomen nach einem Nomen: es heißt „das, was“.",
        "Ist das Relativpronomen Objekt, lässt man es oft weg: the book I'm reading.",
      ],
      examples: [
        { t: "The woman who called was very polite.", de: "Die Frau, die angerufen hat, war sehr höflich." },
        { t: "The bike (that) I bought is blue.", de: "Das Fahrrad, das ich gekauft habe, ist blau.", note: "Objekt → kann wegfallen" },
        { t: "I have a friend whose father is a pilot.", de: "Ich habe einen Freund, dessen Vater Pilot ist." },
        { t: "That's what I said.", de: "Das ist, was ich gesagt habe." },
      ],
    },
    "grammar:used_to": {
      title: "used to",
      body: [
        "Used to + Grundform heißt „früher …“: was regelmäßig so war und heute nicht mehr. I used to play football.",
        "In Frage und Verneinung steht did, dann use to ohne d: Did you use to …? I didn't use to …",
        "Nicht verwechseln: be used to + -ing heißt „an etwas gewöhnt sein“ (I'm used to working late), get used to + -ing „sich daran gewöhnen“.",
      ],
      examples: [
        { t: "I used to live in Spain.", de: "Früher habe ich in Spanien gelebt." },
        { t: "Did you use to have long hair?", de: "Hattest du früher lange Haare?" },
        { t: "I'm used to the noise.", de: "Ich bin an den Lärm gewöhnt." },
        { t: "You'll get used to it.", de: "Du wirst dich daran gewöhnen." },
      ],
    },
    "grammar:passive": {
      title: "Das Passiv",
      body: [
        "Das Passiv bildest du mit be + dritte Verbform: The windows are cleaned. Die Zeit zeigt sich nur an be: was cleaned, has been cleaned, will be cleaned.",
        "Wer etwas tut, steht mit by dahinter: The film was directed by Sofia Coppola. Oft lässt man ihn weg, weil er unwichtig oder unbekannt ist.",
        "Auf Reisen begegnet es dir ständig: The flight has been delayed. Breakfast is served from seven.",
      ],
      examples: [
        { t: "The flight has been cancelled.", de: "Der Flug wurde gestrichen." },
        { t: "Breakfast is served from seven.", de: "Frühstück gibt es ab sieben." },
        { t: "My phone was stolen.", de: "Mein Handy wurde gestohlen." },
        { t: "It was painted by Picasso.", de: "Es wurde von Picasso gemalt.", note: "von → by" },
      ],
    },

  };

  return { LEVELS, UNITS, GUIDES };
})();
