/* HTTP-Server: liefert die App aus und stellt die Datenbank-API bereit.

   Die Wahrheit liegt in Postgres. Der Browser spricht nur mit dieser API,
   ein Agent spricht über den MCP-Server mit derselben Datenbank. */

const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const db = require("./db.js");
const store = require("./store.js");
const briefing = require("./briefing.js");
const mcpHttp = require("./mcp-http.js");
const lessons = require("./lessons.js");

globalThis.TEXT = require("../src/text.js");
const PACKS = require("../src/packs.js");

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const APP_DIR = process.env.APP_DIR || path.join(__dirname, "..");
/* Getrennter Port, der ausschließlich /mcp bedient. Nur dieser wird nach außen
   getunnelt – die App und /api bleiben lokal. Ohne den zweiten Listener würde
   ein Tunnel die komplette, ungeschützte API mit veröffentlichen. */
const MCP_PORT = Number(process.env.MCP_PORT || 0);
const MAX_BODY = 32 * 1024 * 1024;

// ---------- HTTP-Hilfen ----------
const send = (res, code, body, type = "application/json; charset=utf-8") => {
  const payload = type.startsWith("application/json") ? JSON.stringify(body) : body;
  res.writeHead(code, {
    "Content-Type": type,
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
};

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
      if (!text) return resolve(null);
      try { resolve(JSON.parse(text)); } catch (e) { reject(new Error("ungültiges JSON")); }
    });
    req.on("error", reject);
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8", ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

async function serveStatic(res, root, relPath) {
  const target = path.resolve(root, "." + path.posix.normalize("/" + relPath));
  if (target !== root && !target.startsWith(root + path.sep)) return send(res, 403, { error: "verboten" });
  let stat;
  try { stat = await fsp.stat(target); } catch (e) { return send(res, 404, { error: "nicht gefunden" }); }
  if (stat.isDirectory()) return serveStatic(res, root, path.posix.join(relPath, "index.html"));
  res.writeHead(200, {
    "Content-Type": MIME[path.extname(target).toLowerCase()] || "application/octet-stream",
    "Content-Length": stat.size,
    "Cache-Control": "no-cache",
  });
  fs.createReadStream(target).pipe(res);
}

// ---------- Live-Benachrichtigung über neue Übungen ----------
/* Postgres meldet Änderungen an `exercises` per NOTIFY; wir reichen das als
   Server-Sent-Event an alle offenen Tabs weiter. Damit erscheint eine Übung,
   die ein Agent anlegt, ohne Zutun in der App. */
const sseClients = new Set();
// Diese Verbindung bleibt dauerhaft belegt; ohne sie beim Beenden freizugeben
// wartet pool.end() ewig und der Container braucht den vollen Timeout.
let notifyClient = null;

async function startNotifyBridge() {
  const client = await db.connect().connect();
  notifyClient = client;
  await client.query("LISTEN exercises_changed");
  await client.query("LISTEN lessons_changed");
  client.on("notification", (msg) => {
    const name = msg.channel === "lessons_changed" ? "lessons" : "exercises";
    const data = `event: ${name}\ndata: ${JSON.stringify({ id: msg.payload })}\n\n`;
    sseClients.forEach((res) => res.write(data));
  });
  client.on("error", (e) => {
    console.error("LISTEN-Verbindung verloren, neuer Versuch in 5s:", e.message);
    client.release(true);
    setTimeout(() => startNotifyBridge().catch(() => {}), 5000);
  });
  console.log("Auf exercises_changed und lessons_changed lauschend");
}

function handleEvents(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  res.write("retry: 3000\n\n");
  sseClients.add(res);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => { clearInterval(ping); sseClients.delete(res); });
}

// ---------- API ----------
async function handleApi(req, res, url) {
  const route = url.pathname.slice("/api/".length);
  const q = url.searchParams;

  if (req.method === "GET" && route === "health") {
    const { rows } = await db.query("SELECT count(*)::int AS n FROM events");
    return send(res, 200, { ok: true, backend: "postgres", events: rows[0].n });
  }

  if (req.method === "GET" && route === "stream") return handleEvents(req, res);

  if (req.method === "GET" && route === "snapshot") {
    const [state, cards, events, exercises] = await Promise.all([
      store.getSettings(), store.getCards(), store.getEvents(), store.getExercises({ status: "ready" }),
    ]);
    return send(res, 200, { state, cards, events, packs: exercises, packErrors: [] });
  }

  if (req.method === "PUT" && route === "state") {
    const body = await readBody(req);
    if (!body || typeof body !== "object") return send(res, 400, { error: "state erwartet" });
    await store.putSettings(body);
    return send(res, 200, { ok: true });
  }

  if (req.method === "PATCH" && route === "cards") {
    const body = await readBody(req);
    if (!body || typeof body !== "object") return send(res, 400, { error: "Karten erwartet" });
    const written = await store.upsertCards(body);
    return send(res, 200, { ok: true, written });
  }

  if (req.method === "POST" && route === "events") {
    const body = await readBody(req);
    const seqs = await store.appendEvents(body);
    if (!seqs.length) return send(res, 400, { error: "kein gültiges Ereignis" });
    return send(res, 200, { seqs });
  }

  if (req.method === "GET" && route === "events") {
    return send(res, 200, await store.getEvents({
      kind: q.get("kind"), since: q.get("since"), limit: q.get("limit"),
    }));
  }

  if (req.method === "GET" && route === "packs") {
    return send(res, 200, { packs: await store.getExercises({ status: "ready" }), errors: [] });
  }

  /* Import aus der App: dieselbe Prüfung wie beim Agenten. */
  if (req.method === "POST" && route === "packs") {
    const body = await readBody(req);
    const { pack, errors } = PACKS.parse(body && (body.raw || body), "Import");
    if (!pack) return send(res, 400, { error: "Übungssatz ungültig", errors });
    const saved = await store.upsertExercise({ ...pack, schema: PACKS.SCHEMA, status: "ready" });
    return send(res, 200, { ok: true, exercise: saved, errors });
  }

  if (req.method === "DELETE" && route.startsWith("packs/")) {
    await store.deleteExercise(decodeURIComponent(route.slice("packs/".length)));
    return send(res, 200, { ok: true });
  }

  // ---------- Lektionen ----------
  if (req.method === "GET" && route === "lesson") {
    const lesson = await lessons.getLesson(q.get("day"));
    return send(res, 200, lesson || null);
  }
  if (req.method === "POST" && route.startsWith("lesson/") && route.endsWith("/submit")) {
    const lessonId = Number(route.slice("lesson/".length, -"/submit".length));
    const body = await readBody(req);
    if (!body || !["listening", "writing", "speaking"].includes(body.part)) {
      return send(res, 400, { error: "part muss listening, writing oder speaking sein" });
    }
    const row = await lessons.submit(lessonId, body.part, body.content || {});
    return send(res, 200, { ok: true, id: row.id, submittedAt: row.submitted_at });
  }

  if (req.method === "GET" && route === "weaknesses") {
    return send(res, 200, await store.weaknesses({
      days: Number(q.get("days")) || 30, limit: Number(q.get("limit")) || 12,
    }));
  }

  if (req.method === "GET" && route === "briefing") {
    const w = await store.weaknesses({ days: Number(q.get("days")) || 30 });
    const md = briefing.toMarkdown(w, { schema: PACKS.SCHEMA, itemTypes: PACKS.typeNames() });
    return send(res, 200, md, "text/markdown; charset=utf-8");
  }

  return send(res, 404, { error: "unbekannte Route" });
}

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || "localhost"}`); }
  catch (e) { return send(res, 400, { error: "ungültige URL" }); }
  try {
    // MCP über HTTP – dieselben Werkzeuge wie über stdio.
    if (url.pathname === "/mcp" || url.pathname === "/mcp/") return await mcpHttp.handle(req, res);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "nur GET" });
    return await serveStatic(res, path.resolve(APP_DIR), url.pathname === "/" ? "/index.html" : url.pathname);
  } catch (e) {
    console.error("Fehler bei", req.method, url.pathname, "-", e.message);
    if (!res.headersSent) send(res, 500, { error: e.message });
  }
});

// ---------- Start und sauberes Beenden ----------
/* Als PID 1 im Container ignoriert Node Signale ohne eigenen Handler –
   ohne das hier dauert jedes `docker compose stop` zehn Sekunden und endet
   mit SIGKILL. */
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} empfangen, fahre herunter …`);
  sseClients.forEach((res) => res.end());
  if (notifyClient) { notifyClient.release(true); notifyClient = null; }
  server.close(async () => {
    await db.close().catch(() => {});
    process.exit(0);
  });
  // Offene Keep-alive-Verbindungen würden server.close() sonst hinhalten.
  if (server.closeAllConnections) server.closeAllConnections();
  if (mcpOnlyServer) {
    mcpOnlyServer.close();
    if (mcpOnlyServer.closeAllConnections) mcpOnlyServer.closeAllConnections();
  }
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

/* Nur MCP, sonst nichts. Alles andere bekommt 404, damit ein Tunnel auf diesen
   Port keine weitere Angriffsfläche öffnet. */
const mcpOnlyServer = MCP_PORT ? http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, `http://${req.headers.host || "localhost"}`); }
  catch (e) { return send(res, 400, { error: "ungültige URL" }); }
  if (url.pathname !== "/mcp" && url.pathname !== "/mcp/") {
    return send(res, 404, { error: "Dieser Port bedient ausschließlich /mcp." });
  }
  try { await mcpHttp.handle(req, res); }
  catch (e) { if (!res.headersSent) send(res, 500, { error: e.message }); }
}) : null;

(async () => {
  // Ein öffentlich erreichbarer Endpunkt ohne Token wäre ein offenes
  // Schreibrecht auf die Datenbank. Lieber gar nicht starten.
  if (MCP_PORT && !mcpHttp.requiresToken()) {
    console.error("MCP_PORT ist gesetzt, aber MCP_TOKEN fehlt. Ein öffentlicher " +
                  "Endpunkt ohne Token käme einem offenen Schreibzugriff gleich. Abbruch.");
    process.exit(1);
  }
  await db.init();
  await startNotifyBridge();
  server.listen(PORT, HOST, () => {
    const base = `http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`;
    console.log(`Vokabeltrainer läuft auf ${base}`);
    console.log(`MCP-Endpunkt: ${base}/mcp` +
      (mcpHttp.requiresToken() ? " (Bearer-Token nötig)" : " (ohne Token – nur für localhost geeignet)"));
  });
  if (mcpOnlyServer) {
    mcpOnlyServer.listen(MCP_PORT, HOST, () =>
      console.log(`MCP-only-Port ${MCP_PORT} bereit (nur /mcp, Token erzwungen) — für den Tunnel`));
  }
})().catch((e) => {
  console.error("Start fehlgeschlagen:", e.message);
  process.exit(1);
});
