-- Base schema.
--
-- Guiding idea: `events` is append-only and the truth. Everything that
-- describes a weakness is a view on top of it - so app and agent can never
-- give different answers to "what hasn't stuck?".

CREATE EXTENSION IF NOT EXISTS unaccent;

-- ---------- Content (mirrored from deck.js/grammar.js/conjugate.js) ----------
-- Kept in the database so an agent can connect weaknesses to content
-- directly, without reading the JavaScript files.

CREATE TABLE vocabulary (
  es          text PRIMARY KEY,
  de          text NOT NULL,           -- Alternativen mit | getrennt
  de_primary  text NOT NULL,
  pos         text NOT NULL,
  level       text NOT NULL,
  topic       text NOT NULL,
  example_es  text,
  example_de  text
);
CREATE INDEX vocabulary_topic_idx ON vocabulary (topic);
CREATE INDEX vocabulary_level_idx ON vocabulary (level);

CREATE TABLE verbs (
  infinitive  text PRIMARY KEY,
  de          text NOT NULL,
  irregular   boolean NOT NULL,
  verb_group  text NOT NULL
);

CREATE TABLE grammar_items (
  id          text PRIMARY KEY,
  category    text NOT NULL,
  prompt      text NOT NULL,
  options     text[] NOT NULL,
  answer      text NOT NULL,
  explanation text NOT NULL
);
CREATE INDEX grammar_items_category_idx ON grammar_items (category);

CREATE TABLE labels (               -- Anzeigenamen für Zeiten, Personen, Kategorien
  kind  text NOT NULL,
  key   text NOT NULL,
  label text NOT NULL,
  PRIMARY KEY (kind, key)
);

-- ---------- Learning state ----------

CREATE TABLE settings (
  only_row boolean PRIMARY KEY DEFAULT true CHECK (only_row),
  data     jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE cards (
  id            text PRIMARY KEY REFERENCES vocabulary(es) ON DELETE CASCADE,
  state         text NOT NULL CHECK (state IN ('new','learning','review','relearning')),
  stability     double precision NOT NULL DEFAULT 0,
  difficulty    double precision NOT NULL DEFAULT 5,
  due           bigint NOT NULL DEFAULT 0,      -- Epoch-Millisekunden, wie im Scheduler
  last_review   bigint NOT NULL DEFAULT 0,
  reps          integer NOT NULL DEFAULT 0,
  lapses        integer NOT NULL DEFAULT 0,
  step          integer NOT NULL DEFAULT 0,
  interval_days integer NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cards_due_idx ON cards (due) WHERE state <> 'new';

-- Append-only. Never UPDATE, never DELETE.
CREATE TABLE events (
  seq     bigserial PRIMARY KEY,
  t       timestamptz NOT NULL DEFAULT now(),
  kind    text NOT NULL CHECK (kind IN ('vocab','conj','grammar','pack')),
  ok      boolean NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX events_kind_t_idx ON events (kind, t DESC);
CREATE INDEX events_t_idx ON events (t DESC);
CREATE INDEX events_payload_idx ON events USING gin (payload);

-- ---------- Exercise sets written by an agent ----------

CREATE TABLE exercises (
  id             text PRIMARY KEY,
  schema_version text NOT NULL,
  title          text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description    text NOT NULL DEFAULT '',
  created_by     text NOT NULL DEFAULT 'unbekannt',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  focus          text[] NOT NULL DEFAULT '{}',
  -- draft: created by the agent but not finished; the app shows only "ready".
  status         text NOT NULL DEFAULT 'ready' CHECK (status IN ('draft','ready','archived')),
  items          jsonb NOT NULL,
  CONSTRAINT items_is_array   CHECK (jsonb_typeof(items) = 'array'),
  CONSTRAINT items_size       CHECK (jsonb_array_length(items) BETWEEN 1 AND 100)
);
CREATE INDEX exercises_status_idx ON exercises (status, created_at DESC);

-- The app should see new exercises without anyone reloading.
CREATE OR REPLACE FUNCTION notify_exercises() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('exercises_changed', COALESCE(NEW.id, OLD.id));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER exercises_changed
AFTER INSERT OR UPDATE OR DELETE ON exercises
FOR EACH ROW EXECUTE FUNCTION notify_exercises();

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER exercises_touch BEFORE UPDATE ON exercises
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------- Analysis: the only definition of "weakness" ----------

-- Words that go wrong - together with the word they were confused with.
-- That confusion is the reason the typed answer is logged at all.
CREATE VIEW v_vocab_mistakes AS
WITH agg AS (
  SELECT payload->>'id' AS es,
         count(*)                        AS attempts,
         count(*) FILTER (WHERE NOT ok)  AS wrong
  FROM events WHERE kind = 'vocab' GROUP BY 1
)
SELECT a.es,
       v.de_primary,
       v.topic,
       v.level,
       a.attempts,
       a.wrong,
       round(100.0 * (a.attempts - a.wrong) / NULLIF(a.attempts, 0))::int AS accuracy,
       l.typed        AS last_typed,
       l.t            AS last_wrong_at,
       c.es           AS confused_with_es,
       c.de_primary   AS confused_with_de
FROM agg a
JOIN vocabulary v ON v.es = a.es
LEFT JOIN LATERAL (
  SELECT e.payload->>'typed' AS typed, e.t
  FROM events e
  WHERE e.kind = 'vocab' AND NOT e.ok AND e.payload->>'id' = a.es
  ORDER BY e.t DESC LIMIT 1
) l ON true
LEFT JOIN LATERAL (
  SELECT c2.es, c2.de_primary
  FROM vocabulary c2
  WHERE l.typed IS NOT NULL AND c2.es <> a.es
    AND (lower(unaccent(c2.de_primary)) = lower(unaccent(l.typed))
      OR lower(unaccent(c2.es))         = lower(unaccent(l.typed)))
  LIMIT 1
) c ON true
WHERE a.wrong > 0;

-- Careful: `labels` also has a `kind` column, which is why every reference
-- to the event table is qualified explicitly here.
CREATE VIEW v_conjugation_mistakes AS
SELECT e.payload->>'verb'            AS verb,
       e.payload->>'tense'           AS tense,
       (e.payload->>'person')::int   AS person,
       tl.label                      AS tense_label,
       pl.label                      AS person_label,
       count(*)                         AS attempts,
       count(*) FILTER (WHERE NOT e.ok) AS wrong,
       (array_agg(e.payload->>'typed' ORDER BY e.t DESC)
          FILTER (WHERE NOT e.ok))[1]   AS last_typed,
       (array_agg(e.payload->>'expected' ORDER BY e.t DESC)
          FILTER (WHERE NOT e.ok))[1]   AS expected,
       max(e.t)                         AS last_at
FROM events e
LEFT JOIN labels tl ON tl.kind = 'tense'  AND tl.key = e.payload->>'tense'
LEFT JOIN labels pl ON pl.kind = 'person' AND pl.key = e.payload->>'person'
WHERE e.kind = 'conj'
GROUP BY 1,2,3,4,5
HAVING count(*) FILTER (WHERE NOT e.ok) > 0;

CREATE VIEW v_conjugation_by_tense AS
SELECT e.payload->>'tense' AS tense,
       coalesce(l.label, e.payload->>'tense') AS label,
       count(*) AS attempts,
       round(100.0 * count(*) FILTER (WHERE e.ok) / count(*))::int AS accuracy
FROM events e LEFT JOIN labels l ON l.kind = 'tense' AND l.key = e.payload->>'tense'
WHERE e.kind = 'conj' GROUP BY 1, 2;

CREATE VIEW v_conjugation_by_person AS
SELECT (e.payload->>'person')::int AS person,
       coalesce(l.label, e.payload->>'person') AS label,
       count(*) AS attempts,
       round(100.0 * count(*) FILTER (WHERE e.ok) / count(*))::int AS accuracy
FROM events e LEFT JOIN labels l ON l.kind = 'person' AND l.key = e.payload->>'person'
WHERE e.kind = 'conj' GROUP BY 1, 2;

CREATE VIEW v_grammar_accuracy AS
SELECT e.payload->>'category' AS category,
       coalesce(l.label, e.payload->>'category') AS label,
       count(*) AS attempts,
       count(*) FILTER (WHERE NOT e.ok) AS wrong,
       round(100.0 * count(*) FILTER (WHERE e.ok) / count(*))::int AS accuracy
FROM events e LEFT JOIN labels l ON l.kind = 'grammar_category' AND l.key = e.payload->>'category'
WHERE e.kind = 'grammar' GROUP BY 1, 2;

CREATE VIEW v_exercise_results AS
SELECT x.id, x.title, x.status, x.created_by, x.created_at,
       jsonb_array_length(x.items) AS item_count,
       count(e.seq) AS attempts,
       round(100.0 * count(e.seq) FILTER (WHERE e.ok) / NULLIF(count(e.seq), 0))::int AS accuracy,
       max(e.t) AS last_practised
FROM exercises x
LEFT JOIN events e ON e.kind = 'pack' AND e.payload->>'packId' = x.id
GROUP BY x.id;

CREATE VIEW v_daily_activity AS
SELECT (e.t AT TIME ZONE 'Europe/Berlin')::date AS day,
       e.kind,
       count(*) AS answers,
       count(*) FILTER (WHERE e.ok) AS correct
FROM events e GROUP BY 1, 2 ORDER BY 1 DESC;

CREATE VIEW v_summary AS
SELECT (SELECT count(*) FROM vocabulary)                                        AS deck_size,
       (SELECT count(*) FROM cards WHERE state <> 'new')                        AS learned,
       (SELECT count(*) FROM cards WHERE state = 'review' AND stability >= 21)  AS mature,
       (SELECT count(*) FROM cards WHERE state <> 'new' AND due <= (extract(epoch from now()) * 1000)) AS due_now,
       (SELECT count(*) FROM events)                                            AS total_answers,
       (SELECT round(100.0 * count(*) FILTER (WHERE ok) / NULLIF(count(*), 0))::int
          FROM events WHERE t > now() - interval '30 days')                      AS accuracy_30d,
       (SELECT coalesce((data->>'streak')::int, 0) FROM settings)                AS streak;
