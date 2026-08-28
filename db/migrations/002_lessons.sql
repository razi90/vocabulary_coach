-- Tageslektionen: Hören, Schreiben, Sprechen.
--
-- Eine Lektion je Tag. Die drei Teile liegen als jsonb, weil ihr Aufbau sich
-- noch bewegt und jeder Teil anders aussieht – die Prüfung passiert beim
-- Anlegen im MCP-Server, nicht über Spalten.

CREATE TABLE lessons (
  id          bigserial PRIMARY KEY,
  day         date NOT NULL UNIQUE,          -- genau eine Lektion je Tag
  title       text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  theme       text NOT NULL DEFAULT '',
  level       text NOT NULL DEFAULT 'A2',
  created_by  text NOT NULL DEFAULT 'Claude',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  status      text NOT NULL DEFAULT 'ready' CHECK (status IN ('draft','ready','archived')),

  -- { videoId, url, videoTitle, channel, task, questions:[{prompt,options,answer,explanation}] }
  listening   jsonb,
  -- { prompt, targetWords:[], minWords, hints:[] }
  writing     jsonb,
  -- { topic, prompts:[], usefulPhrases:[], minSeconds }
  speaking    jsonb,

  CONSTRAINT hat_einen_teil CHECK (listening IS NOT NULL OR writing IS NOT NULL OR speaking IS NOT NULL)
);
CREATE INDEX lessons_day_idx ON lessons (day DESC);

-- Was der Lernende abgibt. Freier Text kann die App nicht bewerten – deshalb
-- wird er hier abgelegt und der Coach gibt später Rückmeldung.
CREATE TABLE lesson_submissions (
  id           bigserial PRIMARY KEY,
  lesson_id    bigint NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  part         text NOT NULL CHECK (part IN ('listening','writing','speaking')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  content      jsonb NOT NULL,        -- { text } | { transcript, seconds } | { answers, correct, total }
  feedback     text,
  feedback_by  text,
  feedback_at  timestamptz
);
CREATE INDEX lesson_submissions_lesson_idx ON lesson_submissions (lesson_id, part);
CREATE INDEX lesson_submissions_offen_idx ON lesson_submissions (submitted_at)
  WHERE feedback IS NULL;

CREATE TRIGGER lessons_touch BEFORE UPDATE ON lessons
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Wie bei den Übungen: die App soll eine neue Lektion sofort sehen.
CREATE OR REPLACE FUNCTION notify_lessons() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('lessons_changed', COALESCE(NEW.day, OLD.day)::text);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER lessons_changed
AFTER INSERT OR UPDATE OR DELETE ON lessons
FOR EACH ROW EXECUTE FUNCTION notify_lessons();

-- ---------- Sichten ----------

CREATE VIEW v_lesson_today AS
SELECT l.*,
       (SELECT jsonb_object_agg(s.part, jsonb_build_object(
          'submittedAt', s.submitted_at, 'content', s.content,
          'feedback', s.feedback, 'feedbackAt', s.feedback_at))
        FROM lesson_submissions s WHERE s.lesson_id = l.id) AS submissions
FROM lessons l
WHERE l.day = (now() AT TIME ZONE 'Europe/Berlin')::date
  AND l.status = 'ready';

-- Abgaben, die auf Rückmeldung warten. Der Einstieg für den Coach.
CREATE VIEW v_pending_feedback AS
SELECT s.id, s.part, s.submitted_at, s.content,
       l.day, l.title, l.theme, l.level,
       CASE s.part
         WHEN 'writing'  THEN l.writing->>'prompt'
         WHEN 'speaking' THEN l.speaking->>'topic'
         ELSE l.listening->>'task'
       END AS aufgabe
FROM lesson_submissions s
JOIN lessons l ON l.id = s.lesson_id
WHERE s.feedback IS NULL AND s.part IN ('writing','speaking')
ORDER BY s.submitted_at;

CREATE VIEW v_lesson_history AS
SELECT l.day, l.title, l.theme, l.level, l.status,
       (l.listening IS NOT NULL) AS hat_hoeren,
       (l.writing   IS NOT NULL) AS hat_schreiben,
       (l.speaking  IS NOT NULL) AS hat_sprechen,
       count(s.id) FILTER (WHERE s.part = 'listening') AS abgabe_hoeren,
       count(s.id) FILTER (WHERE s.part = 'writing')   AS abgabe_schreiben,
       count(s.id) FILTER (WHERE s.part = 'speaking')  AS abgabe_sprechen,
       count(s.id) FILTER (WHERE s.feedback IS NOT NULL) AS mit_rueckmeldung
FROM lessons l
LEFT JOIN lesson_submissions s ON s.lesson_id = l.id
GROUP BY l.id
ORDER BY l.day DESC;
