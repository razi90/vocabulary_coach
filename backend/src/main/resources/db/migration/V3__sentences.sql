-- Sentence trainer: German -> Spanish, sentences from the words' examples.
--
-- Its own event kind, so sentence mistakes can be told apart from vocabulary
-- mistakes: "knows the word" and "gets the sentence right" are two different
-- things.

ALTER TABLE events DROP CONSTRAINT events_kind_check;
ALTER TABLE events ADD CONSTRAINT events_kind_check
  CHECK (kind IN ('vocab','conj','grammar','pack','sentence'));

-- Which sentences haven't stuck? With the word the sentence hangs off, so an
-- agent can build targeted exercises from it.
CREATE VIEW v_sentence_mistakes AS
SELECT e.payload->>'id'                                   AS word,
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
GROUP BY 1
HAVING count(*) FILTER (WHERE NOT e.ok) > 0
ORDER BY wrong DESC, attempts DESC;
