#!/usr/bin/env node
/* One coach run, without Claude Code in the loop.

   Reads the same instructions a human coach session gets
   (coach-instructions.md), drives the same MCP tools over HTTP, and lets a
   model of your choice do the work. Built for a scheduler: one process, one
   run, exit code says whether it worked.

   The MCP server speaks JSON-RPC, chat APIs speak OpenAI-style tool calls.
   The translation between the two is the only thing in this file that is not
   plumbing - see toOpenAITools() and runTools().

   Env:
     OPENROUTER_API_KEY  required
     COACH_MODEL         default nousresearch/hermes-4-70b
     COACH_API_URL       default OpenRouter; any OpenAI-compatible /chat/completions
     MCP_URL             default http://127.0.0.1:8080/mcp
     MCP_TOKEN           required as soon as the endpoint is not localhost
     COACH_TASK          the request itself; defaults to the daily routine
     COACH_MAX_TURNS     safety net against a model that loops (default 12) */

const fs = require("fs/promises");
const path = require("path");

const API_KEY = process.env.OPENROUTER_API_KEY || "";
const API_URL = process.env.COACH_API_URL || "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.COACH_MODEL || "nousresearch/hermes-4-70b";
const MCP_URL = process.env.MCP_URL || "http://127.0.0.1:8080/mcp";
const MCP_TOKEN = process.env.MCP_TOKEN || "";
const PROMPT_FILE = process.env.COACH_PROMPT || path.join(__dirname, "..", "coach-instructions.md");
const MAX_TURNS = Number(process.env.COACH_MAX_TURNS || 12);
const TIMEOUT_MS = Number(process.env.COACH_TIMEOUT_MS || 120000);

const DEFAULT_TASK =
  "Führe die tägliche Routine aus: erst get_pending_feedback prüfen und offene " +
  "Abgaben beantworten, dann get_briefing lesen und daraus einen passenden " +
  "Übungssatz sowie die Tageslektion anlegen. Fasse am Ende kurz zusammen, was " +
  "du angelegt hast und warum.";

const log = (...args) => console.error(new Date().toISOString(), ...args);

// ---------- MCP over HTTP ----------
/* The endpoint is stateless, so there is no initialize handshake to keep -
   every call stands on its own. */
let rpcId = 0;
async function mcp(method, params) {
  const headers = { "content-type": "application/json", accept: "application/json" };
  if (MCP_TOKEN) headers.authorization = `Bearer ${MCP_TOKEN}`;

  const res = await fetch(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`MCP ${method}: HTTP ${res.status} ${await res.text()}`);

  const body = await res.json();
  if (body.error) throw new Error(`MCP ${method}: ${body.error.message}`);
  return body.result;
}

/* MCP returns content blocks; a chat API wants one string. isError is kept as
   text on purpose: create_exercise rejects with a reason, and the model is
   supposed to read that reason and fix the item. */
function resultToText(result) {
  const text = (result.content || [])
    .filter((b) => b && b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!text) return result.isError ? "Fehler (ohne Meldung)." : "OK (keine Ausgabe).";
  return result.isError ? `FEHLER: ${text}` : text;
}

// ---------- MCP tool schemas -> OpenAI tool definitions ----------
function toOpenAITools(tools) {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      // Some models reject a function without a parameters object.
      parameters: t.inputSchema && t.inputSchema.type
        ? t.inputSchema
        : { type: "object", properties: {} },
    },
  }));
}

// ---------- Chat completion ----------
async function chat(messages, tools) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${API_KEY}`,
      "x-title": "Vocabulary Coach",
    },
    body: JSON.stringify({ model: MODEL, messages, tools, tool_choice: "auto" }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Chat API: HTTP ${res.status} ${await res.text()}`);

  const body = await res.json();
  if (body.error) throw new Error(`Chat API: ${body.error.message || JSON.stringify(body.error)}`);
  const choice = body.choices && body.choices[0];
  if (!choice) throw new Error("Chat API: keine Antwort erhalten.");
  return choice.message;
}

/* Execute every tool call of one turn and return the tool messages.
   A model that emits invalid JSON gets the parse error back as a result
   instead of crashing the run - same principle as the schema rejections. */
async function runTools(calls) {
  const out = [];
  for (const call of calls) {
    const name = call.function && call.function.name;
    let args = {};
    let text;
    try {
      const raw = (call.function && call.function.arguments) || "{}";
      args = typeof raw === "string" ? JSON.parse(raw || "{}") : raw;
    } catch (e) {
      text = `FEHLER: Argumente waren kein gültiges JSON (${e.message}).`;
    }
    if (text === undefined) {
      log(`  -> ${name}(${JSON.stringify(args).slice(0, 120)})`);
      try {
        text = resultToText(await mcp("tools/call", { name, arguments: args }));
      } catch (e) {
        text = `FEHLER: ${e.message}`;
      }
    }
    out.push({ role: "tool", tool_call_id: call.id, name, content: text });
  }
  return out;
}

// ---------- Run ----------
async function main() {
  if (!API_KEY) throw new Error("OPENROUTER_API_KEY fehlt.");

  const system = await fs.readFile(PROMPT_FILE, "utf8");
  const { tools } = await mcp("tools/list");
  log(`${tools.length} Werkzeuge von ${MCP_URL}, Modell ${MODEL}`);

  const messages = [
    { role: "system", content: system },
    { role: "user", content: process.env.COACH_TASK || DEFAULT_TASK },
  ];
  const openAITools = toOpenAITools(tools);

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    const message = await chat(messages, openAITools);
    messages.push(message);

    const calls = message.tool_calls || [];
    if (!calls.length) {
      log(`Fertig nach ${turn} Runden.`);
      console.log((message.content || "").trim());
      return;
    }
    log(`Runde ${turn}: ${calls.length} Werkzeugaufruf(e)`);
    messages.push(...(await runTools(calls)));
  }
  throw new Error(`Nach ${MAX_TURNS} Runden kein Abschluss - abgebrochen.`);
}

main().catch((e) => {
  log("Coach-Lauf fehlgeschlagen:", e.message);
  process.exit(1);
});
