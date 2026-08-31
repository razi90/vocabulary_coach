/* Alle Datenbankzugriffe der App an einem Ort.

   Nach außen sieht es aus wie vorher (Zustand, Karten, Ereignisse, Übungen);
   darunter liegt jetzt Postgres. Die Ereignistabelle bleibt append-only. */

const db = require("./db.js");

const EPOCH_MS = "(EXTRACT(EPOCH FROM t) * 1000)::bigint";

// ---------- Einstellungen ----------
async function getSettings() {
  const { rows } = await db.query("SELECT data FROM settings WHERE only_row");
  return rows[0] ? rows[0].data : {};
}
async function putSettings(data) {
  await db.query(
    `INSERT INTO settings (only_row, data) VALUES (true, $1::jsonb)
     ON CONFLICT (only_row) DO UPDATE SET data = EXCLUDED.data`, [JSON.stringify(data)]);
}

// ---------- Karten ----------
const CARD_COLS = "id, state, stability, difficulty, due, last_review, reps, lapses, step, interval_days";

async function getCards() {
  const { rows } = await db.query(`SELECT ${CARD_COLS} FROM cards`);
  const out = {};
  rows.forEach((r) => {
    out[r.id] = {
      id: r.id, state: r.state, stability: Number(r.stability), difficulty: Number(r.difficulty),
      due: Number(r.due), lastReview: Number(r.last_review), reps: r.reps,
      lapses: r.lapses, step: r.step, interval: r.interval_days,
    };
  });
  return out;
}

/** Nur geänderte Karten; unbekannte Vokabeln werden übersprungen statt zu scheitern. */
async function upsertCards(cards) {
  const list = Object.values(cards).filter((c) => c && c.id);
  if (!list.length) return 0;
  return db.withTransaction(async (c) => {
    let written = 0;
    for (const card of list) {
      const res = await c.query(
        `INSERT INTO cards (id, state, stability, difficulty, due, last_review, reps, lapses, step, interval_days)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
         WHERE EXISTS (SELECT 1 FROM vocabulary WHERE es = $1)
         ON CONFLICT (id) DO UPDATE SET
           state = EXCLUDED.state, stability = EXCLUDED.stability, difficulty = EXCLUDED.difficulty,
           due = EXCLUDED.due, last_review = EXCLUDED.last_review, reps = EXCLUDED.reps,
           lapses = EXCLUDED.lapses, step = EXCLUDED.step, interval_days = EXCLUDED.interval_days,
           updated_at = now()`,
        [card.id, card.state, card.stability || 0, card.difficulty || 5, Math.round(card.due || 0),
         Math.round(card.lastReview || 0), card.reps || 0, card.lapses || 0, card.step || 0,
         Math.round(card.interval || 0)]
      );
      written += res.rowCount;
    }
    return written;
  });
}

// ---------- Ereignisse (append-only) ----------
const EVENT_KINDS = new Set(["vocab", "conj", "grammar", "pack", "sentence"]);

async function appendEvents(events) {
  const list = (Array.isArray(events) ? events : [events]).filter((e) => e && EVENT_KINDS.has(e.kind));
  if (!list.length) return [];
  return db.withTransaction(async (c) => {
    const seqs = [];
    for (const e of list) {
      const { kind, ok, t, seq, ...payload } = e;
      const { rows } = await c.query(
        `INSERT INTO events (t, kind, ok, payload)
         VALUES (COALESCE($1, now()), $2, $3, $4::jsonb) RETURNING seq`,
        [t ? new Date(Number(t)).toISOString() : null, kind, !!ok, JSON.stringify(payload)]
      );
      seqs.push(Number(rows[0].seq));
    }
    return seqs;
  });
}

/** Ereignisse in der Form, die die App kennt (t als Epoch-Millisekunden). */
async function getEvents({ kind, since, limit } = {}) {
  const where = [], params = [];
  if (kind) { params.push(kind); where.push(`kind = $${params.length}`); }
  if (since) { params.push(Number(since)); where.push(`seq > $${params.length}`); }
  params.push(Math.min(Number(limit) || 100000, 200000));
  const { rows } = await db.query(
    `SELECT seq, ${EPOCH_MS} AS t, kind, ok, payload FROM events
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY seq LIMIT $${params.length}`, params);
  return rows.map((r) => ({ seq: Number(r.seq), t: Number(r.t), kind: r.kind, ok: r.ok, ...r.payload }));
}

// ---------- Übungssätze ----------
function rowToExercise(r) {
  return {
    id: r.id, schema: r.schema_version, title: r.title, description: r.description,
    createdBy: r.created_by, createdAt: r.created_at.toISOString(),
    addedAt: new Date(r.created_at).getTime(), focus: r.focus, status: r.status,
    items: r.items, source: `db:${r.id}`,
  };
}

async function getExercises({ status = "ready" } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM exercises ${status === "all" ? "" : "WHERE status = $1"} ORDER BY created_at DESC`,
    status === "all" ? [] : [status]);
  return rows.map(rowToExercise);
}

async function upsertExercise(e) {
  const { rows } = await db.query(
    `INSERT INTO exercises (id, schema_version, title, description, created_by, focus, status, items)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     ON CONFLICT (id) DO UPDATE SET
       schema_version = EXCLUDED.schema_version, title = EXCLUDED.title,
       description = EXCLUDED.description, created_by = EXCLUDED.created_by,
       focus = EXCLUDED.focus, status = EXCLUDED.status, items = EXCLUDED.items
     RETURNING *`,
    [e.id, e.schema, e.title, e.description || "", e.createdBy || "unbekannt",
     e.focus || [], e.status || "ready", JSON.stringify(e.items)]);
  return rowToExercise(rows[0]);
}

const setExerciseStatus = (id, status) =>
  db.query("UPDATE exercises SET status = $2 WHERE id = $1", [id, status]);
const deleteExercise = (id) => db.query("DELETE FROM exercises WHERE id = $1", [id]);

// ---------- Auswertung (die Views sind die einzige Definition) ----------
async function weaknesses({ days = 30, limit = 12 } = {}) {
  const [summary, vocab, conjForms, byTense, byPerson, grammar, packs] = await Promise.all([
    db.query("SELECT * FROM v_summary"),
    db.query(`SELECT * FROM v_vocab_mistakes WHERE last_wrong_at > now() - ($1 || ' days')::interval
              ORDER BY wrong DESC, attempts DESC LIMIT $2`, [days, limit]),
    db.query(`SELECT * FROM v_conjugation_mistakes WHERE last_at > now() - ($1 || ' days')::interval
              ORDER BY wrong DESC LIMIT $2`, [days, limit]),
    db.query("SELECT * FROM v_conjugation_by_tense ORDER BY accuracy ASC"),
    db.query("SELECT * FROM v_conjugation_by_person ORDER BY accuracy ASC"),
    db.query("SELECT * FROM v_grammar_accuracy ORDER BY accuracy ASC"),
    db.query("SELECT * FROM v_exercise_results ORDER BY created_at DESC"),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    windowDays: days,
    summary: summary.rows[0],
    vocab: vocab.rows,
    conjugation: { forms: conjForms.rows, byTense: byTense.rows, byPerson: byPerson.rows },
    grammar: grammar.rows,
    exercises: packs.rows,
  };
}

module.exports = {
  getSettings, putSettings, getCards, upsertCards,
  appendEvents, getEvents,
  getExercises, upsertExercise, setExerciseStatus, deleteExercise,
  weaknesses,
};
