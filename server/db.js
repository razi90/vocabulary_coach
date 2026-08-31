/* Database access: connection, migrations, mirroring the content.

   The learning content (deck, verbs, grammar items) still lives in the JS
   files - it is source, not user data. At startup it is mirrored into the
   database so an agent can connect weaknesses to content directly. */

const fs = require("fs/promises");
const path = require("path");
const vm = require("vm");
const { Pool } = require("pg");

const MIGRATIONS_DIR = path.join(__dirname, "..", "db", "migrations");
const SRC_DIR = path.join(__dirname, "..", "src");

let pool = null;

function connect() {
  if (pool) return pool;
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    host: process.env.PGHOST || "localhost",
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || "voco",
    password: process.env.PGPASSWORD || "voco",
    database: process.env.PGDATABASE || "voco",
    max: Number(process.env.PGPOOL_MAX || 10),
  });
  pool.on("error", (e) => console.error("Postgres-Pool-Fehler:", e.message));
  return pool;
}

const query = (text, params) => connect().query(text, params);

async function withTransaction(fn) {
  const client = await connect().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Waits until Postgres accepts connections - the container needs a moment. */
async function waitForDatabase(attempts = 40) {
  for (let i = 1; i <= attempts; i++) {
    try { await query("SELECT 1"); return; }
    catch (e) {
      if (i === attempts) throw new Error(`Postgres nicht erreichbar: ${e.message}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

async function migrate() {
  await query(`CREATE TABLE IF NOT EXISTS _migrations (
    name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await query("SELECT name FROM _migrations")).rows.map((r) => r.name));
  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    // Each migration in one transaction: all of it or none of it.
    await withTransaction(async (c) => {
      await c.query(sql);
      await c.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
    });
    console.log(`Migration angewendet: ${file}`);
  }
}

/** Evaluate the content modules in a sandbox - they are pure data. */
async function loadContentModules() {
  const files = ["text.js", "deck.js", "conjugate.js", "grammar.js", "packs.js"];
  const context = vm.createContext({ console, module: undefined });
  for (const file of files) {
    const code = await fs.readFile(path.join(SRC_DIR, file), "utf8");
    vm.runInContext(code, context, { filename: file });
  }
  return {
    DECK: vm.runInContext("DECK", context),
    CONJUGATE: vm.runInContext("CONJUGATE", context),
    GRAMMAR: vm.runInContext("GRAMMAR", context),
  };
}

async function syncContent() {
  const { DECK, CONJUGATE, GRAMMAR } = await loadContentModules();

  await withTransaction(async (c) => {
    for (const d of DECK) {
      await c.query(
        `INSERT INTO vocabulary (es, de, de_primary, pos, level, topic, example_es, example_de)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (es) DO UPDATE SET de = EXCLUDED.de, de_primary = EXCLUDED.de_primary,
           pos = EXCLUDED.pos, level = EXCLUDED.level, topic = EXCLUDED.topic,
           example_es = EXCLUDED.example_es, example_de = EXCLUDED.example_de`,
        [d.es, d.de, d.de.split("|")[0], d.pos, d.level, d.topic, d.ex || null, d.exDe || null]
      );
    }
    // Irregular verbs carry no group - it is implied by the ending.
    const verbGroup = (v) => v.group ||
      v.infinitive.slice(-2).normalize("NFD").replace(/[\u0300-\u036f]/g, "");   // oír -> ir
    for (const v of CONJUGATE.ALL_VERBS) {
      await c.query(
        `INSERT INTO verbs (infinitive, de, irregular, verb_group) VALUES ($1,$2,$3,$4)
         ON CONFLICT (infinitive) DO UPDATE SET de = EXCLUDED.de,
           irregular = EXCLUDED.irregular, verb_group = EXCLUDED.verb_group`,
        [v.infinitive, v.de, !!v.irregular, verbGroup(v)]
      );
    }
    for (const g of GRAMMAR.ITEMS) {
      await c.query(
        `INSERT INTO grammar_items (id, category, prompt, options, answer, explanation)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET category = EXCLUDED.category, prompt = EXCLUDED.prompt,
           options = EXCLUDED.options, answer = EXCLUDED.answer, explanation = EXCLUDED.explanation`,
        [g.id, g.category, g.prompt, g.options, g.answer, g.explanation]
      );
    }

    const labels = [];
    CONJUGATE.TENSES.forEach((t) => labels.push(["tense", t, CONJUGATE.TENSE_LABELS[t]]));
    CONJUGATE.PERSON_LABELS.forEach((l, i) => labels.push(["person", String(i), l]));
    Object.entries(GRAMMAR.CATEGORY_LABELS).forEach(([k, l]) => labels.push(["grammar_category", k, l]));
    for (const [kind, key, label] of labels) {
      await c.query(
        `INSERT INTO labels (kind, key, label) VALUES ($1,$2,$3)
         ON CONFLICT (kind, key) DO UPDATE SET label = EXCLUDED.label`,
        [kind, key, label]
      );
    }

    await c.query(`INSERT INTO settings (only_row, data) VALUES (true, '{}'::jsonb)
                   ON CONFLICT (only_row) DO NOTHING`);
  });

  const counts = await query(
    `SELECT (SELECT count(*) FROM vocabulary) AS vocabulary,
            (SELECT count(*) FROM verbs) AS verbs,
            (SELECT count(*) FROM grammar_items) AS grammar_items`
  );
  return counts.rows[0];
}

async function init() {
  connect();
  await waitForDatabase();
  await migrate();
  const counts = await syncContent();
  console.log(`Inhalte gespiegelt: ${counts.vocabulary} Vokabeln, ${counts.verbs} Verben, ` +
              `${counts.grammar_items} Grammatikaufgaben`);
}

const close = () => (pool ? pool.end() : Promise.resolve());

module.exports = { connect, query, withTransaction, init, migrate, syncContent, waitForDatabase, close };
