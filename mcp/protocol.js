/* Werkzeuge und Protokolllogik des MCP-Servers – ohne Transport.

   Genutzt von mcp/server.js (stdio) und server/mcp-http.js (HTTP). Beide
   Wege müssen sich exakt gleich verhalten, deshalb gibt es das nur einmal. */

const db = require("../server/db.js");
const store = require("../server/store.js");
const briefing = require("../server/briefing.js");

globalThis.TEXT = require("../src/text.js");
const PACKS = require("../src/packs.js");

const SERVER_INFO = { name: "vokabeltrainer", version: "2.0.0" };
const FALLBACK_PROTOCOL = "2025-06-18";

// ---------- Werkzeuge ----------
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
        kind: { type: "string", enum: ["vocab", "conj", "grammar", "pack"] },
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
      // Dieselbe Prüfung wie im Browser – eine Definition von „gültig“.
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
];

const TOOL_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));


// ---------- Protokoll ----------
const asText = (value) => (typeof value === "string" ? value : JSON.stringify(value, null, 2));

/**
 * Eine JSON-RPC-Nachricht verarbeiten.
 * Gibt die Antwort zurück oder null, wenn keine erwartet wird (Notification).
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
          // Version des Clients spiegeln, damit unterschiedliche Stände zusammenpassen.
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
          // Fachliche Fehler gehören ins Ergebnis, damit das Modell sie sieht
          // und korrigieren kann – nicht in einen Protokollfehler.
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
