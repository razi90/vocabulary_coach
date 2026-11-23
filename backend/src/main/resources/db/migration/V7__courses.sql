-- Courses: Spanish and English, both for German speakers.
--
-- Content (vocabulary, verbs, grammar items, labels) belongs to a course.
-- A learner's state is kept per course: everything with user_id now also
-- has course, and every query filters by both. users.course is the course
-- the learner is currently in. Data from before this migration is Spanish.

CREATE TABLE courses (
  id   text PRIMARY KEY,
  name text NOT NULL
);
INSERT INTO courses (id, name) VALUES ('es', 'Spanisch'), ('en', 'Englisch');

ALTER TABLE users ADD COLUMN course text NOT NULL DEFAULT 'es' REFERENCES courses (id);

DROP VIEW IF EXISTS v_vocab_mistakes, v_conjugation_mistakes, v_conjugation_by_tense,
  v_conjugation_by_person, v_grammar_accuracy, v_exercise_results, v_daily_activity,
  v_summary, v_lesson_today, v_pending_feedback, v_lesson_history, v_sentence_mistakes;

-- ---------- Content ----------

ALTER TABLE cards DROP CONSTRAINT cards_id_fkey;

-- "es" was the Spanish word; in a course-neutral table it is the term.
ALTER TABLE vocabulary RENAME COLUMN es TO term;
ALTER TABLE vocabulary RENAME COLUMN example_es TO example_term;
ALTER TABLE vocabulary ADD COLUMN course text NOT NULL DEFAULT 'es' REFERENCES courses (id);
ALTER TABLE vocabulary ALTER COLUMN course DROP DEFAULT;
ALTER TABLE vocabulary DROP CONSTRAINT vocabulary_pkey;
ALTER TABLE vocabulary ADD PRIMARY KEY (course, term);
DROP INDEX vocabulary_topic_idx;
DROP INDEX vocabulary_level_idx;
CREATE INDEX vocabulary_topic_idx ON vocabulary (course, topic);
CREATE INDEX vocabulary_level_idx ON vocabulary (course, level);

ALTER TABLE verbs ADD COLUMN course text NOT NULL DEFAULT 'es' REFERENCES courses (id);
ALTER TABLE verbs ALTER COLUMN course DROP DEFAULT;
ALTER TABLE verbs DROP CONSTRAINT verbs_pkey;
ALTER TABLE verbs ADD PRIMARY KEY (course, infinitive);

ALTER TABLE grammar_items ADD COLUMN course text NOT NULL DEFAULT 'es' REFERENCES courses (id);
ALTER TABLE grammar_items ALTER COLUMN course DROP DEFAULT;
ALTER TABLE grammar_items DROP CONSTRAINT grammar_items_pkey;
ALTER TABLE grammar_items ADD PRIMARY KEY (course, id);
DROP INDEX grammar_items_category_idx;
CREATE INDEX grammar_items_category_idx ON grammar_items (course, category);

ALTER TABLE labels ADD COLUMN course text NOT NULL DEFAULT 'es' REFERENCES courses (id);
ALTER TABLE labels ALTER COLUMN course DROP DEFAULT;
ALTER TABLE labels DROP CONSTRAINT labels_pkey;
ALTER TABLE labels ADD PRIMARY KEY (course, kind, key);

-- ---------- Learner state per course ----------

ALTER TABLE settings ADD COLUMN course text NOT NULL DEFAULT 'es' REFERENCES courses (id);
ALTER TABLE settings ALTER COLUMN course DROP DEFAULT;
ALTER TABLE settings DROP CONSTRAINT settings_pkey;
ALTER TABLE settings ADD PRIMARY KEY (user_id, course);

ALTER TABLE cards ADD COLUMN course text NOT NULL DEFAULT 'es';
ALTER TABLE cards ALTER COLUMN course DROP DEFAULT;
ALTER TABLE cards DROP CONSTRAINT cards_pkey;
ALTER TABLE cards ADD PRIMARY KEY (user_id, course, id);
ALTER TABLE cards ADD CONSTRAINT cards_vocabulary_fkey
  FOREIGN KEY (course, id) REFERENCES vocabulary (course, term) ON DELETE CASCADE;
DROP INDEX cards_due_idx;
CREATE INDEX cards_due_idx ON cards (user_id, course, due) WHERE state <> 'new';

-- Still append-only; the course is the second and last column it gets.
ALTER TABLE events ADD COLUMN course text NOT NULL DEFAULT 'es' REFERENCES courses (id);
ALTER TABLE events ALTER COLUMN course DROP DEFAULT;
DROP INDEX events_user_kind_t_idx;
DROP INDEX events_user_t_idx;
CREATE INDEX events_user_kind_t_idx ON events (user_id, course, kind, t DESC);
CREATE INDEX events_user_t_idx ON events (user_id, course, t DESC);

ALTER TABLE exercises ADD COLUMN course text NOT NULL DEFAULT 'es' REFERENCES courses (id);
ALTER TABLE exercises ALTER COLUMN course DROP DEFAULT;
ALTER TABLE exercises DROP CONSTRAINT exercises_pkey;
ALTER TABLE exercises ADD PRIMARY KEY (user_id, course, id);
DROP INDEX exercises_status_idx;
CREATE INDEX exercises_status_idx ON exercises (user_id, course, status, created_at DESC);

ALTER TABLE lessons ADD COLUMN course text NOT NULL DEFAULT 'es' REFERENCES courses (id);
ALTER TABLE lessons ALTER COLUMN course DROP DEFAULT;
ALTER TABLE lessons DROP CONSTRAINT lessons_user_day_key;
ALTER TABLE lessons ADD CONSTRAINT lessons_user_course_day_key UNIQUE (user_id, course, day);
DROP INDEX lessons_day_idx;
CREATE INDEX lessons_day_idx ON lessons (user_id, course, day DESC);

ALTER TABLE coach_runs ADD COLUMN course text NOT NULL DEFAULT 'es' REFERENCES courses (id);
ALTER TABLE coach_runs ALTER COLUMN course DROP DEFAULT;

-- ---------- Views, per learner and course ----------

CREATE VIEW v_vocab_mistakes AS
WITH agg AS (
  SELECT user_id, course,
         payload->>'id'                  AS term,
         count(*)                        AS attempts,
         count(*) FILTER (WHERE NOT ok)  AS wrong
  FROM events WHERE kind = 'vocab' GROUP BY 1, 2, 3
)
SELECT a.user_id,
       a.course,
       a.term,
       v.de_primary,
       v.topic,
       v.level,
       a.attempts,
       a.wrong,
       round(100.0 * (a.attempts - a.wrong) / NULLIF(a.attempts, 0))::int AS accuracy,
       l.typed        AS last_typed,
       l.t            AS last_wrong_at,
       c.term         AS confused_with,
       c.de_primary   AS confused_with_de
FROM agg a
JOIN vocabulary v ON v.course = a.course AND v.term = a.term
LEFT JOIN LATERAL (
  SELECT e.payload->>'typed' AS typed, e.t
  FROM events e
  WHERE e.user_id = a.user_id AND e.course = a.course AND e.kind = 'vocab' AND NOT e.ok
    AND e.payload->>'id' = a.term
  ORDER BY e.t DESC LIMIT 1
) l ON true
LEFT JOIN LATERAL (
  SELECT c2.term, c2.de_primary
  FROM vocabulary c2
  WHERE l.typed IS NOT NULL AND c2.course = a.course AND c2.term <> a.term
    AND (lower(unaccent(c2.de_primary)) = lower(unaccent(l.typed))
      OR lower(unaccent(c2.term))       = lower(unaccent(l.typed)))
  LIMIT 1
) c ON true
WHERE a.wrong > 0;

-- `labels` also has a `kind` column, hence the qualified references.
CREATE VIEW v_conjugation_mistakes AS
SELECT e.user_id,
       e.course,
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
LEFT JOIN labels tl ON tl.course = e.course AND tl.kind = 'tense'  AND tl.key = e.payload->>'tense'
LEFT JOIN labels pl ON pl.course = e.course AND pl.kind = 'person' AND pl.key = e.payload->>'person'
WHERE e.kind = 'conj'
GROUP BY 1, 2, 3, 4, 5, 6, 7
HAVING count(*) FILTER (WHERE NOT e.ok) > 0;

CREATE VIEW v_conjugation_by_tense AS
SELECT e.user_id,
       e.course,
       e.payload->>'tense' AS tense,
       coalesce(l.label, e.payload->>'tense') AS label,
       count(*) AS attempts,
       round(100.0 * count(*) FILTER (WHERE e.ok) / count(*))::int AS accuracy
FROM events e
LEFT JOIN labels l ON l.course = e.course AND l.kind = 'tense' AND l.key = e.payload->>'tense'
WHERE e.kind = 'conj' GROUP BY 1, 2, 3, 4;

CREATE VIEW v_conjugation_by_person AS
SELECT e.user_id,
       e.course,
       (e.payload->>'person')::int AS person,
       coalesce(l.label, e.payload->>'person') AS label,
       count(*) AS attempts,
       round(100.0 * count(*) FILTER (WHERE e.ok) / count(*))::int AS accuracy
FROM events e
LEFT JOIN labels l ON l.course = e.course AND l.kind = 'person' AND l.key = e.payload->>'person'
WHERE e.kind = 'conj' GROUP BY 1, 2, 3, 4;

CREATE VIEW v_grammar_accuracy AS
SELECT e.user_id,
       e.course,
       e.payload->>'category' AS category,
       coalesce(l.label, e.payload->>'category') AS label,
       count(*) AS attempts,
       count(*) FILTER (WHERE NOT e.ok) AS wrong,
       round(100.0 * count(*) FILTER (WHERE e.ok) / count(*))::int AS accuracy
FROM events e
LEFT JOIN labels l ON l.course = e.course AND l.kind = 'grammar_category' AND l.key = e.payload->>'category'
WHERE e.kind = 'grammar' GROUP BY 1, 2, 3, 4;

CREATE VIEW v_exercise_results AS
SELECT x.user_id, x.course, x.id, x.title, x.status, x.created_by, x.created_at,
       jsonb_array_length(x.items) AS item_count,
       count(e.seq) AS attempts,
       round(100.0 * count(e.seq) FILTER (WHERE e.ok) / NULLIF(count(e.seq), 0))::int AS accuracy,
       max(e.t) AS last_practised
FROM exercises x
LEFT JOIN events e ON e.user_id = x.user_id AND e.course = x.course AND e.kind = 'pack'
  AND e.payload->>'packId' = x.id
GROUP BY x.user_id, x.course, x.id;

CREATE VIEW v_daily_activity AS
SELECT e.user_id,
       e.course,
       (e.t AT TIME ZONE 'Europe/Berlin')::date AS day,
       e.kind,
       count(*) AS answers,
       count(*) FILTER (WHERE e.ok) AS correct
FROM events e GROUP BY 1, 2, 3, 4 ORDER BY 3 DESC;

CREATE VIEW v_summary AS
SELECT u.id AS user_id,
       k.id AS course,
       (SELECT count(*) FROM vocabulary v WHERE v.course = k.id)                     AS deck_size,
       (SELECT count(*) FROM cards c WHERE c.user_id = u.id AND c.course = k.id
          AND c.state <> 'new')                                                      AS learned,
       (SELECT count(*) FROM cards c WHERE c.user_id = u.id AND c.course = k.id
          AND c.state = 'review' AND c.stability >= 21)                              AS mature,
       (SELECT count(*) FROM cards c WHERE c.user_id = u.id AND c.course = k.id
          AND c.state <> 'new' AND c.due <= (extract(epoch from now()) * 1000))      AS due_now,
       (SELECT count(*) FROM events e WHERE e.user_id = u.id AND e.course = k.id)    AS total_answers,
       (SELECT round(100.0 * count(*) FILTER (WHERE e.ok) / NULLIF(count(*), 0))::int
          FROM events e WHERE e.user_id = u.id AND e.course = k.id
          AND e.t > now() - interval '30 days')                                      AS accuracy_30d,
       coalesce((SELECT (s.data->>'streak')::int FROM settings s
          WHERE s.user_id = u.id AND s.course = k.id), 0)                            AS streak
FROM users u CROSS JOIN courses k;

CREATE VIEW v_lesson_today AS
SELECT l.*,
       (SELECT jsonb_object_agg(s.part, jsonb_build_object(
          'submittedAt', s.submitted_at, 'content', s.content,
          'feedback', s.feedback, 'feedbackAt', s.feedback_at))
        FROM lesson_submissions s WHERE s.lesson_id = l.id) AS submissions
FROM lessons l
WHERE l.day = (now() AT TIME ZONE 'Europe/Berlin')::date
  AND l.status = 'ready';

CREATE VIEW v_pending_feedback AS
SELECT l.user_id, l.course, s.id, s.part, s.submitted_at, s.content,
       l.day, l.title, l.theme, l.level,
       CASE s.part
         WHEN 'writing'   THEN l.writing->>'prompt'
         WHEN 'speaking'  THEN l.speaking->>'topic'
         WHEN 'sentences' THEN l.sentences->>'task'
         ELSE l.listening->>'task'
       END AS aufgabe,
       CASE s.part
         WHEN 'sentences' THEN l.sentences->'items'
         WHEN 'listening' THEN l.listening->'transcript'
       END AS vorlage
FROM lesson_submissions s
JOIN lessons l ON l.id = s.lesson_id
WHERE s.feedback IS NULL
  AND (s.part IN ('writing', 'speaking', 'sentences')
       OR (s.part = 'listening' AND s.content ? 'text'))
ORDER BY s.submitted_at;

CREATE VIEW v_lesson_history AS
SELECT l.user_id, l.course, l.day, l.title, l.theme, l.level, l.status,
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
       e.course,
       e.payload->>'id'                                   AS word,
       max(e.payload->>'expected')                        AS sentence,
       max(e.payload->>'prompt')                          AS sentence_de,
       count(*)                                           AS attempts,
       count(*) FILTER (WHERE NOT e.ok)                   AS wrong,
       round(100.0 * count(*) FILTER (WHERE e.ok) / NULLIF(count(*), 0))::int AS accuracy,
       max(e.t)                                           AS last_at,
       (array_agg(e.payload->>'typed' ORDER BY e.t DESC)
          FILTER (WHERE NOT e.ok))[1:5]                   AS recent_wrong
FROM events e
WHERE e.kind = 'sentence'
GROUP BY 1, 2, 3
HAVING count(*) FILTER (WHERE NOT e.ok) > 0
ORDER BY wrong DESC, attempts DESC;
