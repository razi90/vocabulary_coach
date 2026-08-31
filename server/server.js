/* HTTP server: serves the app and exposes the database API.

   The truth lives in Postgres. The browser talks to this API only; an agent
   talks to the same database through the MCP server. */

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
/* Separate port serving /mcp exclusively. Only this one gets tunnelled to the
   outside - the app and /api stay local. Without the second listener a tunnel
   would publish the entire unprotected API along with it. */
const MCP_PORT = Number(process.env.MCP_PORT || 0);
const MAX_BODY = 32 * 1024 * 1024;

// ---------- HTTP helpers ----------
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

// ---------- Live notification about new exercises ----------
/* Postgres reports changes to `exercises` via NOTIFY; we forward that as a
   server-sent event to every open tab. An exercise an agent creates thus
   appears in the app without anyone doing anything. */
const sseClients = new Set();
// This connection stays occupied for good; without releasing it on shutdown
// pool.end() waits forever and the container burns the full timeout.
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
  const dev = process.env.NODE_ENV !== "production";
  if (dev) console.log(`Stream verbunden (${sseClients.size} offen)`);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => {
    clearInterval(ping);
    sseClients.delete(res);
    if (dev) console.log(`Stream getrennt (${sseClients.size} offen)`);
  });
}

// ---------- Live reload in development ----------
/* When a file in the working tree changes, the browser reloads by itself.
   Runs only outside NODE_ENV=production.

   Deliberately polling instead of fs.watch: across the Docker mount on macOS
   the recursive watcher loses a file as soon as an editor replaces it by
   writing a temp file and renaming it. The first change arrives, no further
   one does - until the process restarts. A few dozen stat() calls every
   500 ms cost nothing and work reliably. */
const RELOAD_EXT = new Set([".html", ".js", ".css", ".webmanifest"]);
const RELOAD_SKIP = new Set(["node_modules", "fortschritt", "beispiele"]);
const RELOAD_INTERVAL = 500;
// Changes here affect the running process, not just the page.
const SERVER_DIRS = ["server/", "mcp/"];

async function collectStamps(dir, root, out) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || RELOAD_SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { await collectStamps(full, root, out); continue; }
    if (!RELOAD_EXT.has(path.extname(entry.name))) continue;
    const stat = await fsp.stat(full).catch(() => null);
    if (stat) out.set(path.relative(root, full), `${stat.mtimeMs}:${stat.size}`);
  }
  return out;
}

function startReloadWatcher() {
  if (process.env.NODE_ENV === "production") return;
  const root = path.resolve(APP_DIR);
  let known = null;
  let busy = false;

  const tick = async () => {
    if (busy || shuttingDown) return;
    busy = true;
    try {
      const now = await collectStamps(root, root, new Map());
      if (!known) { known = now; return; }
      const changed = [...now].filter(([f, s]) => known.get(f) !== s).map(([f]) => f);
      const removed = [...known.keys()].filter((f) => !now.has(f));
      known = now;
      const touched = [...changed, ...removed];
      if (!touched.length) return;

      // Server files: the process has to restart. Docker brings it back up
      // by itself thanks to "restart: unless-stopped".
      if (touched.some((f) => SERVER_DIRS.some((d) => f.startsWith(d)))) {
        console.log(`${touched.join(", ")} geändert – Server startet neu`);
        return shutdown("Dateiänderung");
      }
      console.log(`${touched.join(", ")} geändert – Browser lädt neu`);
      sseClients.forEach((res) => res.write("event: reload\ndata: {}\n\n"));
    } catch (e) {
      console.warn("Live-Reload: Durchlauf fehlgeschlagen:", e.message);
    } finally {
      busy = false;
    }
  };

  setInterval(tick, RELOAD_INTERVAL).unref();
  console.log(`Live-Reload aktiv (Abfrage alle ${RELOAD_INTERVAL} ms)`);
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

  /* Import from the app: the same validation as for the agent. */
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

  // ---------- Lessons ----------
  if (req.method === "GET" && route === "lesson") {
    const lesson = await lessons.getLesson(q.get("day"));
    return send(res, 200, lesson || null);
  }
  if (req.method === "POST" && route.startsWith("lesson/") && route.endsWith("/submit")) {
    const lessonId = Number(route.slice("lesson/".length, -"/submit".length));
    const body = await readBody(req);
    if (!body || !["listening", "writing", "speaking", "sentences"].includes(body.part)) {
      return send(res, 400, { error: "part muss listening, writing, speaking oder sentences sein" });
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
    // MCP over HTTP - the same tools as over stdio.
    if (url.pathname === "/mcp" || url.pathname === "/mcp/") return await mcpHttp.handle(req, res);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "nur GET" });
    return await serveStatic(res, path.resolve(APP_DIR), url.pathname === "/" ? "/index.html" : url.pathname);
  } catch (e) {
    console.error("Fehler bei", req.method, url.pathname, "-", e.message);
    if (!res.headersSent) send(res, 500, { error: e.message });
  }
});

// ---------- Startup and clean shutdown ----------
/* As PID 1 in the container, Node ignores signals without a handler of its
   own - without this, every `docker compose stop` takes ten seconds and ends
   in SIGKILL. */
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
  // Open keep-alive connections would otherwise stall server.close().
  if (server.closeAllConnections) server.closeAllConnections();
  if (mcpOnlyServer) {
    mcpOnlyServer.close();
    if (mcpOnlyServer.closeAllConnections) mcpOnlyServer.closeAllConnections();
  }
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

/* MCP and nothing else. Everything else gets a 404, so a tunnel to this port
   opens no further attack surface. */
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
  // A publicly reachable endpoint without a token would be open write access
  // to the database. Better not to start at all.
  if (MCP_PORT && !mcpHttp.requiresToken()) {
    console.error("MCP_PORT ist gesetzt, aber MCP_TOKEN fehlt. Ein öffentlicher " +
                  "Endpunkt ohne Token käme einem offenen Schreibzugriff gleich. Abbruch.");
    process.exit(1);
  }
  await db.init();
  await startNotifyBridge();
  startReloadWatcher();
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
