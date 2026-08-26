/* MCP über HTTP ("Streamable HTTP").

   Damit bekommt der Server eine URL und ist für Clients erreichbar, die keinen
   lokalen Prozess starten können. Werkzeuge und Protokoll sind dieselben wie
   bei stdio – hier liegt nur der Transport.

   Der Server ist zustandslos: jede Anfrage steht für sich. Eine Sitzungs-ID
   wird zurückgegeben, weil Clients sie erwarten, aber nicht ausgewertet. */

const crypto = require("crypto");
const { handleMessage } = require("../mcp/protocol.js");

const MAX_BODY = 4 * 1024 * 1024;
const PROTOCOL_HEADER = "mcp-protocol-version";

/* Ohne Token ist jeder, der den Port erreicht, berechtigt, in die Datenbank zu
   schreiben. Auf 127.0.0.1 vertretbar – sobald der Port nach außen geht, nicht
   mehr. Deshalb: MCP_TOKEN setzen. */
const TOKEN = process.env.MCP_TOKEN || "";

function unauthorized(res) {
  res.writeHead(401, {
    "Content-Type": "application/json; charset=utf-8",
    "WWW-Authenticate": 'Bearer realm="vokabeltrainer"',
  });
  res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Nicht autorisiert" } }));
}

function authorized(req) {
  if (!TOKEN) return true;
  const header = req.headers.authorization || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (given.length !== TOKEN.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(TOKEN));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("Anfrage zu groß")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.trim()) return resolve(null);
      try { resolve(JSON.parse(text)); } catch (e) { reject(new Error("Ungültiges JSON")); }
    });
    req.on("error", reject);
  });
}

const json = (res, code, body, extra = {}) => {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    ...extra,
  });
  res.end(payload);
};

async function handle(req, res) {
  if (!authorized(req)) return unauthorized(res);

  // Clients prüfen die Erreichbarkeit teils per GET; wir bieten keinen
  // servergetriebenen Kanal an und sagen das ehrlich.
  if (req.method === "GET") {
    return json(res, 405, { jsonrpc: "2.0", id: null,
      error: { code: -32000, message: "Nur POST; dieser Server sendet nicht von sich aus." } },
      { Allow: "POST, DELETE" });
  }

  if (req.method === "DELETE") return json(res, 200, { ok: true });   // Sitzungsende

  if (req.method !== "POST") {
    return json(res, 405, { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Nur POST" } },
      { Allow: "POST, DELETE" });
  }

  let body;
  try { body = await readBody(req); }
  catch (e) { return json(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: e.message } }); }
  if (!body) return json(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Leere Anfrage" } });

  const isBatch = Array.isArray(body);
  const messages = isBatch ? body : [body];
  const responses = [];
  for (const msg of messages) {
    const reply = await handleMessage(msg);
    if (reply) responses.push(reply);
  }

  const headers = {};
  // Bei initialize eine Sitzungs-ID mitgeben; Clients erwarten sie teils.
  if (messages.some((m) => m && m.method === "initialize")) {
    headers["Mcp-Session-Id"] = crypto.randomUUID();
  }
  const version = req.headers[PROTOCOL_HEADER];
  if (version) headers["MCP-Protocol-Version"] = version;

  // Nur Notifications: nichts zu antworten.
  if (!responses.length) {
    res.writeHead(202, { "Content-Length": 0, ...headers });
    return res.end();
  }
  return json(res, 200, isBatch ? responses : responses[0], headers);
}

module.exports = { handle, requiresToken: () => !!TOKEN };
