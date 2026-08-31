/* Tools and protocol logic of the MCP server - without the transport.

   Used by mcp/server.js (stdio) and server/mcp-http.js (HTTP). Both routes
   have to behave exactly alike, which is why this exists only once. */

const db = require("../server/db.js");
const store = require("../server/store.js");
const briefing = require("../server/briefing.js");
const lessons = require("../server/lessons.js");

globalThis.TEXT = require("../src/text.js");
const PACKS = require("../src/packs.js");

const SERVER_INFO = { name: "vokabeltrainer", version: "2.0.0" };
const FALLBACK_PROTOCOL = "2025-06-18";

// ---------- Tools ----------
const TOOLS = [
  {
    name: "get_briefing",
    description:
      "Der Lernstand als Markdown: Kennzahlen, hartnäckige Vokabeln, Konjugations- und " +
      "Grammatikschwächen sowie ein konkreter Übungsauftrag. Der beste Einstieg.",
    inputSchema: {
      type: "object",
      properties: { days: { type: "integer", minimum: 1, maximum: 3650, default: 30,
        description: "Betrachtungszeitraum in Tagen." } },
    },
    handler: async ({ days = 30 }) => {
      const w = await store.weaknesses({ days });
      return briefing.toMarkdown(w, { schema: PACKS.SCHEMA, itemTypes: PACKS.typeNames() });
    },
  },
  {
    name: "get_weaknesses",
    description:
      "Dieselbe Auswertung wie get_briefing, aber strukturiert als JSON: Kennzahlen, " +
      "Vokabelfehler samt Verwechslungen, Konjugation nach Form/Zeit/Person, Grammatik " +
      "nach Kategorie, Ergebnisse gelieferter Übungssätze.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "integer", minimum: 1, maximum: 3650, default: 30 },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 12,
          description: "Wie viele Einzelposten je Liste." },
      },
    },
    handler: ({ days = 30, limit = 12 }) => store.weaknesses({ days, limit }),
  },
  {
    name: "query_events",
    description:
      "Rohes Antwortprotokoll, append-only. Eine Zeile je Antwort mit Zeitpunkt, Art " +
      "(vocab/conj/grammar/pack), richtig/falsch und – bei Tippaufgaben – der tatsächlichen " +
      "Eingabe. Für Auswertungen, die die fertigen Sichten nicht abdecken.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["vocab", "conj", "grammar", "pack", "sentence"] },
        since: { type: "integer", description: "Nur Ereignisse mit seq größer als dieser Wert." },
        limit: { type: "integer", minimum: 1, maximum: 5000, default: 200 },
      },
    },
    handler: ({ kind, since, limit = 200 }) => store.getEvents({ kind, since, limit }),
  },
  {
    name: "search_vocabulary",
    description:
      "Das Vokabular durchsuchen – nach Text, Thema, Niveau oder Wortart. Nützlich, um " +
      "Übungen aus Wörtern zu bauen, die der Lernende wirklich kennt.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Teilstring in spanischer oder deutscher Form." },
        topic: { type: "string" },
        level: { type: "string", enum: ["A1", "A2", "B1"] },
        pos: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 500, default: 50 },
      },
    },
    handler: async ({ search, topic, level, pos, limit = 50 }) => {
      const where = [], params = [];
      if (search) { params.push(`%${search}%`); where.push(`(es ILIKE $${params.length} OR de ILIKE $${params.length})`); }
      if (topic) { params.push(topic); where.push(`topic = $${params.length}`); }
      if (level) { params.push(level); where.push(`level = $${params.length}`); }
      if (pos) { params.push(pos); where.push(`pos = $${params.length}`); }
      params.push(limit);
      const { rows } = await db.query(
        `SELECT v.es, v.de_primary, v.de, v.pos, v.level, v.topic, v.example_es, v.example_de,
                c.state, c.stability, c.lapses
         FROM vocabulary v LEFT JOIN cards c ON c.id = v.es
         ${where.length ? "WHERE " + where.join(" AND ") : ""}
         ORDER BY v.es LIMIT $${params.length}`, params);
      return rows;
    },
  },
  {
    name: "list_exercises",
    description: "Vorhandene Übungssätze samt Status und bisherigen Ergebnissen.",
    inputSchema: {
      type: "object",
      properties: { status: { type: "string", enum: ["ready", "draft", "archived", "all"], default: "all" } },
    },
    handler: async ({ status = "all" }) => {
      const list = await store.getExercises({ status });
      const { rows } = await db.query("SELECT * FROM v_exercise_results");
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      return list.map((e) => ({
        id: e.id, title: e.title, status: e.status, createdBy: e.createdBy, createdAt: e.createdAt,
        items: e.items.length, results: byId[e.id]
          ? { attempts: Number(byId[e.id].attempts), accuracy: byId[e.id].accuracy, lastPractised: byId[e.id].last_practised }
          : null,
      }));
    },
  },
  {
    name: "create_exercise",
    description:
      "Einen Übungssatz anlegen oder ersetzen. Er erscheint sofort in der App im Tab „Übungen“ " +
      "(bei status=ready). Aufgabentypen: choice (Auswahl, options + answer), cloze (Lückentext " +
      "mit ___ und answer), translate (prompt + answer). Bei cloze und translate werden Akzente " +
      "ignoriert und ein Tippfehler als „fast richtig“ gewertet – eine Wortverwechslung nicht. " +
      "In `explanation` gehört das Warum, nicht die Lösung.",
    inputSchema: {
      type: "object",
      required: ["id", "title", "items"],
      properties: {
        id: { type: "string", description: "Stabiler Bezeichner, z. B. por-para-grund-vs-zweck." },
        title: { type: "string" },
        description: { type: "string" },
        focus: { type: "array", items: { type: "string" },
          description: "Grammatikkategorien oder Themen, z. B. [\"por_para\"]." },
        status: { type: "string", enum: ["ready", "draft"], default: "ready" },
        items: {
          type: "array", minItems: 1, maxItems: 100,
          items: {
            type: "object",
            required: ["type", "prompt"],
            properties: {
              type: { type: "string", enum: ["choice", "cloze", "translate"] },
              prompt: { type: "string" },
              options: { type: "array", items: { type: "string" } },
              answer: { type: "string" },
              alternatives: { type: "array", items: { type: "string" } },
              explanation: { type: "string" },
              hint: { type: "string" },
              from: { type: "string" },
              to: { type: "string" },
            },
          },
        },
      },
    },
    handler: async (args) => {
      const raw = {
        schema: PACKS.SCHEMA, id: args.id, title: args.title,
        description: args.description || "", createdBy: "Claude",
        createdAt: new Date().toISOString(), focus: args.focus || [], items: args.items,
      };
      // The same validation as in the browser - one definition of "valid".
      const { pack, errors } = PACKS.parse(raw, args.id);
      if (!pack) {
        const e = new Error(`Übungssatz abgelehnt:\n- ${errors.join("\n- ")}`);
        e.isUserError = true;
        throw e;
      }
      const saved = await store.upsertExercise({ ...pack, schema: PACKS.SCHEMA, status: args.status || "ready" });
      return {
        ok: true, id: saved.id, status: saved.status, accepted: saved.items.length,
        skipped: errors.length ? errors : undefined,
        note: "Die App zeigt den Satz sofort an; offene Tabs aktualisieren sich selbst.",
      };
    },
  },
  {
    name: "set_exercise_status",
    description: "Status eines Übungssatzes ändern: ready (sichtbar), draft (verborgen), archived.",
    inputSchema: {
      type: "object", required: ["id", "status"],
      properties: { id: { type: "string" }, status: { type: "string", enum: ["ready", "draft", "archived"] } },
    },
    handler: async ({ id, status }) => {
      const r = await store.setExerciseStatus(id, status);
      if (!r.rowCount) { const e = new Error(`Kein Übungssatz mit id "${id}"`); e.isUserError = true; throw e; }
      return { ok: true, id, status };
    },
  },
  {
    name: "delete_exercise",
    description: "Einen Übungssatz endgültig entfernen. Bereits protokollierte Antworten bleiben erhalten.",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "string" } } },
    handler: async ({ id }) => {
      const r = await store.deleteExercise(id);
      if (!r.rowCount) { const e = new Error(`Kein Übungssatz mit id "${id}"`); e.isUserError = true; throw e; }
      return { ok: true, id };
    },
  },

  // ---------- Daily lessons ----------
  {
    name: "create_lesson",
    description:
      "Legt die Tageslektion an (überschreibt eine vorhandene desselben Tages). Eine Lektion " +
      "besteht aus bis zu vier Teilen: listening (YouTube-Video mit Verständnisfragen), " +
      "writing (Schreibauftrag), speaking (Sprechthema) und sentences (Sätze übersetzen). " +
      "Mindestens einer ist nötig.\n\n" +
      "Zu sentences: 5–10 deutsche Sätze, die der Lernende ins Spanische überträgt. Bau sie aus " +
      "Wörtern, die er schon kennt — such sie vorher mit search_vocabulary heraus, dort steht der " +
      "Lernstand je Wort. Ein Satz je Stolperstelle aus dem Briefing ist mehr wert als zehn " +
      "beliebige. Die Abgabe kommt über get_pending_feedback zurück; dort steht auch deine " +
      "gedachte Lösung, damit du siehst, worauf der Satz hinauswollte. Bewerte großzügig: eine " +
      "andere Wortstellung oder ein Synonym ist kein Fehler, solange der Satz stimmt.\n\n" +
      "WICHTIG zum Video: Die videoId wird beim Anlegen gegen YouTube geprüft. Eine erfundene " +
      "oder nicht einbettbare ID führt zur Ablehnung. Nimm eine ID aus einem echten Suchtreffer, " +
      "nie aus dem Gedächtnis. Titel und Kanal holt der Server selbst.",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: {
        day: { type: "string", description: "JJJJ-MM-TT. Ohne Angabe: heute (Europe/Berlin)." },
        title: { type: "string" },
        theme: { type: "string", description: "Thema, z. B. „Im Restaurant bestellen“." },
        level: { type: "string", enum: ["A1", "A2", "B1"] },
        status: { type: "string", enum: ["ready", "draft"], default: "ready" },
        listening: {
          type: "object",
          properties: {
            url: { type: "string", description: "YouTube-URL oder 11-stellige videoId." },
            videoId: { type: "string" },
            task: { type: "string", description: "Was beim Hören zu tun ist." },
            questions: {
              type: "array", minItems: 1, maxItems: 10,
              description: "Verständnisfragen als Auswahl; answer muss exakt eine der options sein.",
              items: {
                type: "object",
                required: ["prompt", "options", "answer"],
                properties: {
                  prompt: { type: "string" },
                  options: { type: "array", items: { type: "string" }, minItems: 2 },
                  answer: { type: "string" },
                  explanation: { type: "string" },
                },
              },
            },
          },
        },
        writing: {
          type: "object",
          required: ["prompt"],
          properties: {
            prompt: { type: "string", description: "Der Schreibauftrag, auf Deutsch gestellt." },
            targetWords: { type: "array", items: { type: "string" },
              description: "Spanische Wörter/Wendungen, die vorkommen sollen." },
            minWords: { type: "integer", minimum: 10, maximum: 500, default: 50 },
            hints: { type: "array", items: { type: "string" } },
          },
        },
        sentences: {
          type: "object",
          required: ["items"],
          description: "Sätze zum Übersetzen. Kein Zeichenkettenvergleich – du bewertest sie selbst.",
          properties: {
            task: { type: "string", description: "Arbeitsauftrag. Ohne Angabe: „Übersetze die Sätze ins Spanische.“" },
            items: {
              type: "array", minItems: 3, maxItems: 12,
              items: {
                type: "object",
                required: ["de", "es"],
                properties: {
                  de: { type: "string", description: "Der deutsche Satz, den der Lernende sieht." },
                  es: { type: "string", description: "Deine gedachte Lösung. Der Lernende sieht sie nie." },
                  note: { type: "string", description: "Worauf der Satz zielt, z. B. „por vs. para“." },
                },
              },
            },
          },
        },
        speaking: {
          type: "object",
          required: ["topic"],
          properties: {
            topic: { type: "string" },
            prompts: { type: "array", items: { type: "string" },
              description: "Leitfragen, die beim Sprechen helfen." },
            usefulPhrases: { type: "array", items: { type: "string" } },
            minSeconds: { type: "integer", minimum: 15, maximum: 600, default: 60 },
          },
        },
      },
    },
    handler: async (args) => {
      const row = await lessons.createLesson(args);
      return {
        ok: true, day: row.day.toISOString().slice(0, 10), title: row.title,
        teile: ["listening", "writing", "speaking"].filter((k) => row[k]),
        video: row.listening ? { id: row.listening.videoId, titel: row.listening.videoTitle,
                                 kanal: row.listening.channel } : null,
        hinweis: "Die Lektion steht sofort im Tab „Lektion“ der App.",
      };
    },
  },
  {
    name: "get_lesson",
    description: "Eine Lektion samt Abgaben des Lernenden. Ohne day: heute.",
    inputSchema: { type: "object", properties: { day: { type: "string" } } },
    handler: async ({ day }) => (await lessons.getLesson(day)) || { hinweis: "Für diesen Tag gibt es keine Lektion." },
  },
  {
    name: "list_lessons",
    description: "Bisherige Lektionen mit Übersicht, was abgegeben und was schon rückgemeldet wurde.",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100, default: 30 } } },
    handler: ({ limit }) => lessons.listLessons(limit),
  },
  {
    name: "get_pending_feedback",
    description:
      "Abgaben zu Schreiben, Sprechen und Sätzen, die noch keine Rückmeldung haben – samt " +
      "Aufgabenstellung und dem, was der Lernende geschrieben oder gesagt hat. Beim Sprechen ist es " +
      "ein Transkript aus der Spracherkennung des Browsers; Erkennungsfehler sind möglich und keine " +
      "Sprachfehler. Beim Satzteil steht in `vorlage` deine gedachte Lösung je Satz.",
    inputSchema: { type: "object", properties: {} },
    handler: () => lessons.pendingFeedback(),
  },
  {
    name: "give_feedback",
    description:
      "Rückmeldung zu einer Abgabe hinterlegen. Sie erscheint in der App unter der Aufgabe. " +
      "Auf Deutsch schreiben, konkret auf den Text eingehen, Fehler benennen und verbessert zeigen.",
    inputSchema: {
      type: "object", required: ["submissionId", "feedback"],
      properties: {
        submissionId: { type: "integer" },
        feedback: { type: "string" },
      },
    },
    handler: async ({ submissionId, feedback }) => {
      const row = await lessons.giveFeedback(submissionId, feedback);
      return { ok: true, id: row.id, part: row.part };
    },
  },
];

const TOOL_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));


// ---------- Protocol ----------
const asText = (value) => (typeof value === "string" ? value : JSON.stringify(value, null, 2));

/**
 * Handle one JSON-RPC message.
 * Returns the response, or null when none is expected (notification).
 */
async function handleMessage(msg) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;
  const reply = (result) => (isNotification ? null : { jsonrpc: "2.0", id, result });
  const fail = (code, message) => (isNotification ? null : { jsonrpc: "2.0", id, error: { code, message } });

  try {
    switch (method) {
      case "initialize":
        return reply({
          // Mirror the client's version so differing revisions still match.
          protocolVersion: (params && params.protocolVersion) || FALLBACK_PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            "Lernstand eines Spanisch-Vokabeltrainers. Mit get_briefing anfangen, dann mit " +
            "create_exercise gezielte Übungen anlegen – sie erscheinen sofort in der App.",
        });

      case "notifications/initialized":
      case "notifications/cancelled":
        return null;

      case "ping":
        return reply({});

      case "tools/list":
        return reply({
          tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
        });

      case "tools/call": {
        const tool = TOOL_BY_NAME[params && params.name];
        if (!tool) return fail(-32602, `Unbekanntes Werkzeug: ${params && params.name}`);
        try {
          const value = await tool.handler((params && params.arguments) || {});
          return reply({ content: [{ type: "text", text: asText(value) }] });
        } catch (e) {
          // Domain errors belong in the result, so the model sees them and
          // can correct them - not in a protocol error.
          return reply({ content: [{ type: "text", text: e.message }], isError: true });
        }
      }

      default:
        return fail(-32601, `Unbekannte Methode: ${method}`);
    }
  } catch (e) {
    return fail(-32603, e.message);
  }
}

module.exports = { TOOLS, TOOL_BY_NAME, handleMessage, SERVER_INFO, FALLBACK_PROTOCOL };
