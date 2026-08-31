#!/usr/bin/env node
/* MCP server over stdio.

   The transport only; tools and protocol live in mcp/protocol.js and are
   shared with the HTTP variant. */

const db = require("../server/db.js");
const { handleMessage, TOOLS } = require("./protocol.js");

function write(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); }
    catch (e) { write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Ungültiges JSON" } }); continue; }
    const response = await handleMessage(msg);
    if (response) write(response);
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
  // stderr, so stdout belongs to the protocol.
  console.error("MCP-Server (stdio) bereit, Werkzeuge:", TOOLS.map((t) => t.name).join(", "));
})().catch((e) => {
  console.error("MCP-Start fehlgeschlagen:", e.message);
  process.exit(1);
});
