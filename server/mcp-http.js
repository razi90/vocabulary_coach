/* MCP over HTTP ("Streamable HTTP").

   This gives the server a URL and makes it reachable for clients that cannot
   start a local process. Tools and protocol are the same as over stdio - only
   the transport lives here.

   The server is stateless: every request stands on its own. A session ID is
   returned because clients expect one, but it is never evaluated. */

const crypto = require("crypto");
const { handleMessage } = require("../mcp/protocol.js");

const MAX_BODY = 4 * 1024 * 1024;
const PROTOCOL_HEADER = "mcp-protocol-version";

/* Without a token, anyone who can reach the port is allowed to write to the
   database. Defensible on 127.0.0.1 - no longer so once the port faces
   outwards. Hence: set MCP_TOKEN. */
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

  // Some clients probe reachability with GET; we offer no server-driven
  // channel and say so honestly.
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
  // Hand out a session ID on initialize; some clients expect one.
  if (messages.some((m) => m && m.method === "initialize")) {
    headers["Mcp-Session-Id"] = crypto.randomUUID();
  }
  const version = req.headers[PROTOCOL_HEADER];
  if (version) headers["MCP-Protocol-Version"] = version;

  // Notifications only: nothing to answer.
  if (!responses.length) {
    res.writeHead(202, { "Content-Length": 0, ...headers });
    return res.end();
  }
  return json(res, 200, isBatch ? responses : responses[0], headers);
}

module.exports = { handle, requiresToken: () => !!TOKEN };
