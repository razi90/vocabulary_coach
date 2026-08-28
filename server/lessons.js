/* Tageslektionen: Hören, Schreiben, Sprechen.

   Der heikle Teil ist das Video. Ein Agent kann eine YouTube-ID erfinden, ohne
   es zu merken – im Browser bliebe dann ein toter Rahmen stehen. Deshalb wird
   jede ID beim Anlegen gegen die oEmbed-Schnittstelle geprüft und die Lektion
   sonst abgelehnt. Titel und Kanal kommen aus derselben Antwort, damit später
   nachvollziehbar bleibt, worauf sich die Aufgabe bezog. */

const db = require("./db.js");

const str = (v) => (typeof v === "string" ? v.trim() : "");
const strList = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

class LessonError extends Error {
  constructor(message) { super(message); this.isUserError = true; }
}

/** Video-ID aus allen üblichen YouTube-Adressen ziehen. */
function extractVideoId(input) {
  const value = str(input);
  if (!value) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const m = value.match(re);
    if (m) return m[1];
  }
  return null;
}

/** Existiert das Video wirklich? Gibt Titel und Kanal zurück. */
async function verifyVideo(videoId) {
  const url = `https://www.youtube.com/oembed?url=${
    encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`;
  let res;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    res = await fetch(url, { signal: ctl.signal });
    clearTimeout(timer);
  } catch (e) {
    throw new LessonError(`YouTube war nicht erreichbar (${e.message}). Später erneut versuchen.`);
  }
  if (res.status === 404 || res.status === 400 || res.status === 401 || res.status === 403) {
    throw new LessonError(
      `Das Video "${videoId}" gibt es nicht oder es lässt sich nicht einbetten. ` +
      `Bitte eine ID aus einem echten Suchtreffer nehmen, nicht aus dem Gedächtnis.`);
  }
  if (!res.ok) throw new LessonError(`YouTube antwortete mit ${res.status}.`);
  const data = await res.json();
  return { videoTitle: str(data.title), channel: str(data.author_name) };
}

async function normalizeListening(raw) {
  if (!raw) return null;
  const videoId = extractVideoId(raw.videoId || raw.url);
  if (!videoId) {
    throw new LessonError("listening braucht eine YouTube-URL oder eine 11-stellige videoId.");
  }
  const { videoTitle, channel } = await verifyVideo(videoId);

  const questions = (Array.isArray(raw.questions) ? raw.questions : []).slice(0, 10).map((q, i) => {
    const prompt = str(q && q.prompt);
    const options = strList(q && q.options);
    const answer = str(q && q.answer);
    if (!prompt) throw new LessonError(`Hörfrage ${i + 1}: prompt fehlt.`);
    if (options.length < 2) throw new LessonError(`Hörfrage ${i + 1}: mindestens zwei options nötig.`);
    if (!options.includes(answer)) {
      throw new LessonError(`Hörfrage ${i + 1}: answer "${answer}" ist keine der options.`);
    }
    return { prompt, options, answer, explanation: str(q.explanation) };
  });
  if (!questions.length) throw new LessonError("listening braucht mindestens eine Verständnisfrage.");

  return {
    videoId, videoTitle, channel,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    task: str(raw.task) || "Sieh das Video und beantworte die Fragen.",
    questions,
  };
}

function normalizeWriting(raw) {
  if (!raw) return null;
  const prompt = str(raw.prompt);
  if (!prompt) throw new LessonError("writing braucht einen prompt.");
  const minWords = Number(raw.minWords) || 50;
  if (minWords < 10 || minWords > 500) throw new LessonError("writing.minWords muss zwischen 10 und 500 liegen.");
  return {
    prompt,
    targetWords: strList(raw.targetWords).slice(0, 12),
    minWords,
    hints: strList(raw.hints).slice(0, 6),
  };
}

function normalizeSpeaking(raw) {
  if (!raw) return null;
  const topic = str(raw.topic);
  if (!topic) throw new LessonError("speaking braucht ein topic.");
  const minSeconds = Number(raw.minSeconds) || 60;
  if (minSeconds < 15 || minSeconds > 600) throw new LessonError("speaking.minSeconds muss zwischen 15 und 600 liegen.");
  return {
    topic,
    prompts: strList(raw.prompts).slice(0, 8),
    usefulPhrases: strList(raw.usefulPhrases).slice(0, 12),
    minSeconds,
  };
}

const heute = () => new Date(Date.now() + 0).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });

async function createLesson(input) {
  const day = str(input.day) || heute();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new LessonError("day muss im Format JJJJ-MM-TT stehen.");
  const title = str(input.title);
  if (!title) throw new LessonError("title fehlt.");

  const [listening, writing, speaking] = [
    await normalizeListening(input.listening),
    normalizeWriting(input.writing),
    normalizeSpeaking(input.speaking),
  ];
  if (!listening && !writing && !speaking) {
    throw new LessonError("Eine Lektion braucht mindestens einen Teil (listening, writing oder speaking).");
  }

  const { rows } = await db.query(
    `INSERT INTO lessons (day, title, theme, level, created_by, status, listening, writing, speaking)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb)
     ON CONFLICT (day) DO UPDATE SET
       title = EXCLUDED.title, theme = EXCLUDED.theme, level = EXCLUDED.level,
       created_by = EXCLUDED.created_by, status = EXCLUDED.status,
       listening = EXCLUDED.listening, writing = EXCLUDED.writing, speaking = EXCLUDED.speaking
     RETURNING *`,
    [day, title, str(input.theme), str(input.level) || "A2", str(input.createdBy) || "Claude",
     str(input.status) || "ready",
     listening && JSON.stringify(listening), writing && JSON.stringify(writing),
     speaking && JSON.stringify(speaking)]
  );
  return rows[0];
}

async function getLesson(day) {
  const { rows } = await db.query(
    `SELECT l.*, (SELECT jsonb_object_agg(s.part, jsonb_build_object(
        'submittedAt', s.submitted_at, 'content', s.content,
        'feedback', s.feedback, 'feedbackAt', s.feedback_at))
      FROM lesson_submissions s WHERE s.lesson_id = l.id) AS submissions
     FROM lessons l WHERE l.day = $1`, [day || heute()]);
  return rows[0] || null;
}

const listLessons = async (limit = 30) =>
  (await db.query("SELECT * FROM v_lesson_history LIMIT $1", [limit])).rows;

const pendingFeedback = async () =>
  (await db.query("SELECT * FROM v_pending_feedback")).rows;

async function submit(lessonId, part, content) {
  const { rows } = await db.query(
    `INSERT INTO lesson_submissions (lesson_id, part, content)
     VALUES ($1,$2,$3::jsonb) RETURNING *`,
    [lessonId, part, JSON.stringify(content)]);
  return rows[0];
}

async function giveFeedback(submissionId, feedback, by = "Claude") {
  const { rows } = await db.query(
    `UPDATE lesson_submissions SET feedback = $2, feedback_by = $3, feedback_at = now()
     WHERE id = $1 RETURNING *`, [submissionId, feedback, by]);
  if (!rows[0]) throw new LessonError(`Keine Abgabe mit id ${submissionId}.`);
  return rows[0];
}

module.exports = {
  createLesson, getLesson, listLessons, pendingFeedback, submit, giveFeedback,
  extractVideoId, verifyVideo, heute, LessonError,
};
