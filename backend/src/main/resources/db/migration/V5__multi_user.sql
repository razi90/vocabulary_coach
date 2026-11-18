-- Several learners, each with their own learning state, and a built-in coach.
--
-- Content (vocabulary, verbs, grammar items, labels) stays shared. Everything
-- a learner produces gets a user_id: settings, cards, events, exercises,
-- lessons (submissions hang off their lesson). The views carry user_id
-- through, so every query filters by it - there is still exactly one
-- definition of "weakness", now per learner.
--
-- Data from before this migration belongs to user 1. That account has no
-- password yet; the app sets one from ADMIN_EMAIL / ADMIN_PASSWORD at startup.

-- The Node server tracked its migrations here; Flyway has its own table now.
DROP TABLE IF EXISTS _migrations;

-- Views first: several of them depend on columns that change below.
DROP VIEW IF EXISTS v_vocab_mistakes, v_conjugation_mistakes, v_conjugation_by_tense,
  v_conjugation_by_person, v_grammar_accuracy, v_exercise_results, v_daily_activity,
  v_summary, v_lesson_today, v_pending_feedback, v_lesson_history, v_sentence_mistakes;

-- ---------- Accounts ----------

CREATE TABLE users (
  id            bigserial PRIMARY KEY,
  email         text NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  password_hash text,                    -- NULL: cannot log in (yet)
  display_name  text NOT NULL DEFAULT '',
  is_admin      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_idx ON users (lower(email));

INSERT INTO users (id, email, display_name, is_admin) VALUES (1, 'admin@localhost', 'Admin', true);
SELECT setval('users_id_seq', 1);

-- Login sessions (Spring Session JDBC), so a restart does not log everyone out.
CREATE TABLE spring_session (
  primary_id            char(36) NOT NULL,
  session_id            char(36) NOT NULL,
  creation_time         bigint NOT NULL,
  last_access_time      bigint NOT NULL,
  max_inactive_interval int NOT NULL,
  expiry_time           bigint NOT NULL,
  principal_name        varchar(100),
  CONSTRAINT spring_session_pk PRIMARY KEY (primary_id)
);
CREATE UNIQUE INDEX spring_session_ix1 ON spring_session (session_id);
CREATE INDEX spring_session_ix2 ON spring_session (expiry_time);
CREATE INDEX spring_session_ix3 ON spring_session (principal_name);

CREATE TABLE spring_session_attributes (
  session_primary_id char(36) NOT NULL,
  attribute_name     varchar(200) NOT NULL,
  attribute_bytes    bytea NOT NULL,
  CONSTRAINT spring_session_attributes_pk PRIMARY KEY (session_primary_id, attribute_name),
  CONSTRAINT spring_session_attributes_fk FOREIGN KEY (session_primary_id)
    REFERENCES spring_session (primary_id) ON DELETE CASCADE
);

-- ---------- Learning state gets an owner ----------

ALTER TABLE settings ADD COLUMN user_id bigint NOT NULL DEFAULT 1 REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE settings ALTER COLUMN user_id DROP DEFAULT;
ALTER TABLE settings DROP CONSTRAINT settings_pkey;
ALTER TABLE settings DROP COLUMN only_row;
ALTER TABLE settings ADD PRIMARY KEY (user_id);

ALTER TABLE cards ADD COLUMN user_id bigint NOT NULL DEFAULT 1 REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE cards ALTER COLUMN user_id DROP DEFAULT;
ALTER TABLE cards DROP CONSTRAINT cards_pkey;
ALTER TABLE cards ADD PRIMARY KEY (user_id, id);
DROP INDEX cards_due_idx;
CREATE INDEX cards_due_idx ON cards (user_id, due) WHERE state <> 'new';

-- Still append-only. Adding the owner is the one schema change it gets.
ALTER TABLE events ADD COLUMN user_id bigint NOT NULL DEFAULT 1 REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE events ALTER COLUMN user_id DROP DEFAULT;
DROP INDEX events_kind_t_idx;
DROP INDEX events_t_idx;
CREATE INDEX events_user_kind_t_idx ON events (user_id, kind, t DESC);
CREATE INDEX events_user_t_idx ON events (user_id, t DESC);

ALTER TABLE exercises ADD COLUMN user_id bigint NOT NULL DEFAULT 1 REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE exercises ALTER COLUMN user_id DROP DEFAULT;
ALTER TABLE exercises DROP CONSTRAINT exercises_pkey;
ALTER TABLE exercises ADD PRIMARY KEY (user_id, id);
DROP INDEX exercises_status_idx;
CREATE INDEX exercises_status_idx ON exercises (user_id, status, created_at DESC);

ALTER TABLE lessons ADD COLUMN user_id bigint NOT NULL DEFAULT 1 REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE lessons ALTER COLUMN user_id DROP DEFAULT;
ALTER TABLE lessons DROP CONSTRAINT lessons_day_key;
ALTER TABLE lessons ADD CONSTRAINT lessons_user_day_key UNIQUE (user_id, day);
DROP INDEX lessons_day_idx;
CREATE INDEX lessons_day_idx ON lessons (user_id, day DESC);
ALTER TABLE lessons ALTER COLUMN created_by SET DEFAULT 'Coach';

-- Notifications name the owner, so the server forwards them only to that
-- learner's open tabs.
CREATE OR REPLACE FUNCTION notify_exercises() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('exercises_changed', json_build_object(
    'user', COALESCE(NEW.user_id, OLD.user_id), 'id', COALESCE(NEW.id, OLD.id))::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION notify_lessons() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('lessons_changed', json_build_object(
    'user', COALESCE(NEW.user_id, OLD.user_id), 'id', COALESCE(NEW.day, OLD.day)::text)::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- ---------- The built-in coach ----------

-- Which LLM a learner's coach uses. The API key is encrypted by the app
-- (AES-GCM, key from APP_ENCRYPTION_KEY); the database never sees it in clear.
CREATE TABLE coach_settings (
  user_id      bigint PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  provider     text NOT NULL CHECK (provider IN ('openrouter', 'opencode_zen')),
  model        text NOT NULL CHECK (length(model) BETWEEN 1 AND 200),
  api_key_enc  bytea,                    -- 12-byte nonce || ciphertext
  api_key_hint text,                     -- last four characters, for display only
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One row per coach run. `steps` is the trace the app shows: which tools the
-- model called and what came back, shortened.
CREATE TABLE coach_runs (
  id                bigserial PRIMARY KEY,
  user_id           bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  task              text NOT NULL CHECK (task IN ('exercises', 'lesson', 'feedback', 'custom')),
  note              text NOT NULL DEFAULT '',
  provider          text NOT NULL,
  model             text NOT NULL,
  status            text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'done', 'failed')),
  steps             jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary           text,
  error             text,
  prompt_tokens     integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz
);
CREATE INDEX coach_runs_user_idx ON coach_runs (user_id, started_at DESC);

CREATE OR REPLACE FUNCTION notify_coach_runs() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('coach_runs_changed', json_build_object('user', NEW.user_id, 'id', NEW.id)::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER coach_runs_changed
AFTER INSERT OR UPDATE ON coach_runs
FOR EACH ROW EXECUTE FUNCTION notify_coach_runs();

-- ---------- Views, now per learner ----------

CREATE VIEW v_vocab_mistakes AS
WITH agg AS (
  SELECT user_id,
         payload->>'id'                  AS es,
         count(*)                        AS attempts,
         count(*) FILTER (WHERE NOT ok)  AS wrong
  FROM events WHERE kind = 'vocab' GROUP BY 1, 2
)
SELECT a.user_id,
       a.es,
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
  WHERE e.user_id = a.user_id AND e.kind = 'vocab' AND NOT e.ok AND e.payload->>'id' = a.es
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

-- `labels` also has a `kind` column, hence the qualified references.
CREATE VIEW v_conjugation_mistakes AS
SELECT e.user_id,
       e.payload->>'verb'            AS verb,
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
GROUP BY 1, 2, 3, 4, 5, 6
HAVING count(*) FILTER (WHERE NOT e.ok) > 0;

CREATE VIEW v_conjugation_by_tense AS
SELECT e.user_id,
       e.payload->>'tense' AS tense,
       coalesce(l.label, e.payload->>'tense') AS label,
       count(*) AS attempts,
       round(100.0 * count(*) FILTER (WHERE e.ok) / count(*))::int AS accuracy
FROM events e LEFT JOIN labels l ON l.kind = 'tense' AND l.key = e.payload->>'tense'
WHERE e.kind = 'conj' GROUP BY 1, 2, 3;

CREATE VIEW v_conjugation_by_person AS
SELECT e.user_id,
       (e.payload->>'person')::int AS person,
       coalesce(l.label, e.payload->>'person') AS label,
       count(*) AS attempts,
       round(100.0 * count(*) FILTER (WHERE e.ok) / count(*))::int AS accuracy
FROM events e LEFT JOIN labels l ON l.kind = 'person' AND l.key = e.payload->>'person'
WHERE e.kind = 'conj' GROUP BY 1, 2, 3;

CREATE VIEW v_grammar_accuracy AS
SELECT e.user_id,
       e.payload->>'category' AS category,
       coalesce(l.label, e.payload->>'category') AS label,
       count(*) AS attempts,
       count(*) FILTER (WHERE NOT e.ok) AS wrong,
       round(100.0 * count(*) FILTER (WHERE e.ok) / count(*))::int AS accuracy
FROM events e LEFT JOIN labels l ON l.kind = 'grammar_category' AND l.key = e.payload->>'category'
WHERE e.kind = 'grammar' GROUP BY 1, 2, 3;

CREATE VIEW v_exercise_results AS
SELECT x.user_id, x.id, x.title, x.status, x.created_by, x.created_at,
       jsonb_array_length(x.items) AS item_count,
       count(e.seq) AS attempts,
       round(100.0 * count(e.seq) FILTER (WHERE e.ok) / NULLIF(count(e.seq), 0))::int AS accuracy,
       max(e.t) AS last_practised
FROM exercises x
LEFT JOIN events e ON e.user_id = x.user_id AND e.kind = 'pack' AND e.payload->>'packId' = x.id
GROUP BY x.user_id, x.id;

CREATE VIEW v_daily_activity AS
SELECT e.user_id,
       (e.t AT TIME ZONE 'Europe/Berlin')::date AS day,
       e.kind,
       count(*) AS answers,
       count(*) FILTER (WHERE e.ok) AS correct
FROM events e GROUP BY 1, 2, 3 ORDER BY 2 DESC;

CREATE VIEW v_summary AS
SELECT u.id AS user_id,
       (SELECT count(*) FROM vocabulary)                                             AS deck_size,
       (SELECT count(*) FROM cards c WHERE c.user_id = u.id AND c.state <> 'new')    AS learned,
       (SELECT count(*) FROM cards c WHERE c.user_id = u.id
          AND c.state = 'review' AND c.stability >= 21)                              AS mature,
       (SELECT count(*) FROM cards c WHERE c.user_id = u.id AND c.state <> 'new'
          AND c.due <= (extract(epoch from now()) * 1000))                           AS due_now,
       (SELECT count(*) FROM events e WHERE e.user_id = u.id)                        AS total_answers,
       (SELECT round(100.0 * count(*) FILTER (WHERE e.ok) / NULLIF(count(*), 0))::int
          FROM events e WHERE e.user_id = u.id AND e.t > now() - interval '30 days')  AS accuracy_30d,
       coalesce((SELECT (s.data->>'streak')::int FROM settings s WHERE s.user_id = u.id), 0) AS streak
FROM users u;

CREATE VIEW v_lesson_today AS
SELECT l.*,
       (SELECT jsonb_object_agg(s.part, jsonb_build_object(
          'submittedAt', s.submitted_at, 'content', s.content,
          'feedback', s.feedback, 'feedbackAt', s.feedback_at))
        FROM lesson_submissions s WHERE s.lesson_id = l.id) AS submissions
FROM lessons l
WHERE l.day = (now() AT TIME ZONE 'Europe/Berlin')::date
  AND l.status = 'ready';

-- Submissions waiting for feedback. The coach's entry point.
CREATE VIEW v_pending_feedback AS
SELECT l.user_id, s.id, s.part, s.submitted_at, s.content,
       l.day, l.title, l.theme, l.level,
       CASE s.part
         WHEN 'writing'   THEN l.writing->>'prompt'
         WHEN 'speaking'  THEN l.speaking->>'topic'
         WHEN 'sentences' THEN l.sentences->>'task'
         ELSE l.listening->>'task'
       END AS aufgabe,
       -- The intended solutions: without them the coach would have to guess
       -- what a sentence was aiming at.
       CASE WHEN s.part = 'sentences' THEN l.sentences->'items' END AS vorlage
FROM lesson_submissions s
JOIN lessons l ON l.id = s.lesson_id
WHERE s.feedback IS NULL AND s.part IN ('writing', 'speaking', 'sentences')
ORDER BY s.submitted_at;

CREATE VIEW v_lesson_history AS
SELECT l.user_id, l.day, l.title, l.theme, l.level, l.status,
       (l.listening IS NOT NULL) AS hat_hoeren,
       (l.writing   IS NOT NULL) AS hat_schreiben,
       (l.speaking  IS NOT NULL) AS hat_sprechen,
       (l.sentences IS NOT NULL) AS hat_saetze,
       count(s.id) FILTER (WHERE s.part = 'listening') AS abgabe_hoeren,
       count(s.id) FILTER (WHERE s.part = 'writing')   AS abgabe_schreiben,
       count(s.id) FILTER (WHERE s.part = 'speaking')  AS abgabe_sprechen,
       count(s.id) FILTER (WHERE s.part = 'sentences') AS abgabe_saetze,
       count(s.id) FILTER (WHERE s.feedback IS NOT NULL) AS mit_rueckmeldung
FROM lessons l
LEFT JOIN lesson_submissions s ON s.lesson_id = l.id
GROUP BY l.id
ORDER BY l.day DESC;

CREATE VIEW v_sentence_mistakes AS
SELECT e.user_id,
       e.payload->>'id'                                   AS word,
       max(e.payload->>'expected')                        AS sentence_es,
       max(e.payload->>'prompt')                          AS sentence_de,
       count(*)                                           AS attempts,
       count(*) FILTER (WHERE NOT e.ok)                   AS wrong,
       round(100.0 * count(*) FILTER (WHERE e.ok) / NULLIF(count(*), 0))::int AS accuracy,
       max(e.t)                                           AS last_at,
       (array_agg(e.payload->>'typed' ORDER BY e.t DESC)
          FILTER (WHERE NOT e.ok))[1:5]                   AS recent_wrong
FROM events e
WHERE e.kind = 'sentence'
GROUP BY 1, 2
HAVING count(*) FILTER (WHERE NOT e.ok) > 0
ORDER BY wrong DESC, attempts DESC;
