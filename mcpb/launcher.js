#!/usr/bin/env node
/* Entry point of the MCPB extension.
 *
 * Starts no server of its own; it pipes stdio into the running container.
 * That keeps the bundle tiny (no node_modules, no pg driver) and leaves only
 * one version of the server.
 *
 * Only the JSON-RPC protocol belongs on stdout; every notice goes to stderr.
 */

const { spawn, spawnSync } = require("child_process");
const fs = require("fs");

const CONTAINER = process.env.VOCO_CONTAINER || "vokabeltrainer";

/* Processes started from a GUI do not inherit a shell's PATH:
   /usr/local/bin, where Docker Desktop lives, is missing there. */
const CANDIDATES = [
  "/usr/local/bin/docker",
  "/opt/homebrew/bin/docker",
  `${process.env.HOME}/.docker/bin/docker`,
  "/Applications/Docker.app/Contents/Resources/bin/docker",
  "/usr/bin/docker",
];

function findDocker() {
  for (const candidate of CANDIDATES) {
    try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch (e) { /* keep looking */ }
  }
  const which = spawnSync("which", ["docker"], { encoding: "utf8" });
  const found = (which.stdout || "").trim();
  return found || null;
}

function fail(message) {
  process.stderr.write(`[Vokabeltrainer] ${message}\n`);
  process.exit(1);
}

const docker = findDocker();
if (!docker) {
  fail("Docker wurde nicht gefunden. Ist Docker Desktop installiert?");
}

if (spawnSync(docker, ["info"], { stdio: "ignore" }).status !== 0) {
  fail("Docker antwortet nicht. Läuft Docker Desktop?");
}

const state = spawnSync(docker, ["inspect", "-f", "{{.State.Running}}", CONTAINER], { encoding: "utf8" });
const exists = state.status === 0;
const running = exists && (state.stdout || "").trim() === "true";

if (!exists) {
  fail(`Container "${CONTAINER}" existiert nicht. Im Projektverzeichnis einmal ` +
       `"docker compose up -d" ausführen.`);
}

if (!running) {
  process.stderr.write(`[Vokabeltrainer] Container "${CONTAINER}" ist gestoppt, starte ihn …\n`);
  if (spawnSync(docker, ["start", CONTAINER], { stdio: "ignore" }).status !== 0) {
    fail(`Container "${CONTAINER}" ließ sich nicht starten.`);
  }
}

const child = spawn(docker, ["exec", "-i", CONTAINER, "node", "/app/mcp/server.js"], {
  stdio: ["pipe", "pipe", "inherit"],
});

process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);

child.on("exit", (code, signal) => process.exit(signal ? 1 : code === null ? 1 : code));
child.on("error", (e) => fail(`Start fehlgeschlagen: ${e.message}`));

const stop = () => { child.kill(); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
