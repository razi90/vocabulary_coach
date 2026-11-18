-- Sentences as a fourth part of the lesson.
--
-- The coach builds 5-10 sentences from words the learner already knows; the
-- learner translates them into Spanish. Grading is not done by string compare
-- - a different word order or a synonym would otherwise be "wrong" - but by
-- the coach, together with the rest of the lesson.

ALTER TABLE lessons ADD COLUMN sentences jsonb;
-- { task, items: [{ de, es, note }] }   es = the solution the coach had in mind

ALTER TABLE lessons DROP CONSTRAINT hat_einen_teil;
ALTER TABLE lessons ADD CONSTRAINT hat_einen_teil CHECK (
  listening IS NOT NULL OR writing IS NOT NULL OR
  speaking IS NOT NULL OR sentences IS NOT NULL
);

ALTER TABLE lesson_submissions DROP CONSTRAINT lesson_submissions_part_check;
ALTER TABLE lesson_submissions ADD CONSTRAINT lesson_submissions_part_check
  CHECK (part IN ('listening','writing','speaking','sentences'));

-- Sentences wait for feedback just like writing and speaking.
DROP VIEW v_pending_feedback;
CREATE VIEW v_pending_feedback AS
SELECT s.id, s.part, s.submitted_at, s.content,
       l.day, l.title, l.theme, l.level,
       CASE s.part
         WHEN 'writing'   THEN l.writing->>'prompt'
         WHEN 'speaking'  THEN l.speaking->>'topic'
         WHEN 'sentences' THEN l.sentences->>'task'
         ELSE l.listening->>'task'
       END AS aufgabe,
       -- For the sentence part, include the intended solutions: without them
       -- the coach would have to guess what the sentence was aiming at.
       CASE WHEN s.part = 'sentences' THEN l.sentences->'items' END AS vorlage
FROM lesson_submissions s
JOIN lessons l ON l.id = s.lesson_id
WHERE s.feedback IS NULL AND s.part IN ('writing','speaking','sentences')
ORDER BY s.submitted_at;

DROP VIEW v_lesson_history;
CREATE VIEW v_lesson_history AS
SELECT l.day, l.title, l.theme, l.level, l.status,
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
