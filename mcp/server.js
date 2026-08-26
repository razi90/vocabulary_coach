#!/usr/bin/env node
/* MCP-Server für den Vokabeltrainer.

   Spricht JSON-RPC 2.0 über stdio – bewusst ohne SDK, damit es keine
   Abhängigkeit gibt, deren Protokollversion mit dem Client auseinanderläuft.
   Die angeforderte Protokollversion des Clients wird zurückgespiegelt.

   Der Server redet direkt mit Postgres, nicht über die HTTP-API: ein Agent
   soll auch arbeiten können, wenn die Web-App gerade niemand offen hat. */

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

// ---------- JSON-RPC über stdio ----------
function write(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}
const result = (id, value) => write({ jsonrpc: "2.0", id, result: value });
const failure = (id, code, message) => write({ jsonrpc: "2.0", id, error: { code, message } });

const asText = (value) => (typeof value === "string" ? value : JSON.stringify(value, null, 2));

async function handleMessage(msg) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  try {
    switch (method) {
      case "initialize":
        return result(id, {
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
        return;

      case "ping":
        return result(id, {});

      case "tools/list":
        return result(id, {
          tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
        });

      case "tools/call": {
        const tool = TOOL_BY_NAME[params && params.name];
        if (!tool) return failure(id, -32602, `Unbekanntes Werkzeug: ${params && params.name}`);
        try {
          const value = await tool.handler((params && params.arguments) || {});
          return result(id, { content: [{ type: "text", text: asText(value) }] });
        } catch (e) {
          // Fachliche Fehler gehören ins Ergebnis, damit das Modell sie sieht
          // und korrigieren kann – nicht in einen Protokollfehler.
          return result(id, { content: [{ type: "text", text: e.message }], isError: true });
        }
      }

      default:
        if (isNotification) return;
        return failure(id, -32601, `Unbekannte Methode: ${method}`);
    }
  } catch (e) {
    if (!isNotification) failure(id, -32603, e.message);
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); }
    catch (e) { failure(null, -32700, "Ungültiges JSON"); continue; }
    handleMessage(msg);
  }
});
process.stdin.on("end", () => shutdown());

async function shutdown() {
  await db.close().catch(() => {});
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

(async () => {
  await db.waitForDatabase();
  // stderr, damit stdout dem Protokoll gehört.
  console.error("MCP-Server bereit, Werkzeuge:", TOOLS.map((t) => t.name).join(", "));
})().catch((e) => {
  console.error("MCP-Start fehlgeschlagen:", e.message);
  process.exit(1);
});
