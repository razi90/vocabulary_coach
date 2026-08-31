-- Satztrainer: Deutsch → Spanisch, Sätze aus den Beispielen der Vokabeln.
--
-- Eigene Ereignisart, damit sich Satzfehler von Vokabelfehlern trennen lassen:
-- "kennt das Wort" und "bekommt den Satz hin" sind zwei verschiedene Dinge.

ALTER TABLE events DROP CONSTRAINT events_kind_check;
ALTER TABLE events ADD CONSTRAINT events_kind_check
  CHECK (kind IN ('vocab','conj','grammar','pack','sentence'));

-- Welche Sätze sitzen nicht? Mit der Vokabel, an der der Satz hängt, damit
-- ein Agent daraus gezielt Übungen bauen kann.
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
