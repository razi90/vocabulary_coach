-- Open listening tasks: when the coach has no transcript of a video, the
-- learner writes what they understood instead of answering questions. Those
-- submissions wait for feedback like writing, speaking and sentences do.
--
-- A listening submission is free text when its content has "text"; answers
-- to multiple-choice questions are graded by the app and need no feedback.

DROP VIEW v_pending_feedback;
CREATE VIEW v_pending_feedback AS
SELECT l.user_id, s.id, s.part, s.submitted_at, s.content,
       l.day, l.title, l.theme, l.level,
       CASE s.part
         WHEN 'writing'   THEN l.writing->>'prompt'
         WHEN 'speaking'  THEN l.speaking->>'topic'
         WHEN 'sentences' THEN l.sentences->>'task'
         ELSE l.listening->>'task'
       END AS aufgabe,
       -- What the coach compares against: its intended solutions for the
       -- sentences, the video's transcript (if there was one) for listening.
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
