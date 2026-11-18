package com.vocabcoach.lessons;

import com.vocabcoach.UserError;
import com.vocabcoach.db.Rows;
import com.vocabcoach.learning.Course;
import com.vocabcoach.learning.Learner;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Daily lessons: listening, writing, speaking, sentences.
 *
 * <p>The delicate part is the video. A model can invent a YouTube ID without
 * noticing - the browser would be left with a dead frame. So every ID is
 * checked against YouTube on creation and the lesson rejected otherwise.
 * Title and channel come from the same response.
 */
@Service
public class LessonService {

  public static final ZoneId BERLIN = ZoneId.of("Europe/Berlin");
  private static final Pattern BARE_ID = Pattern.compile("^[A-Za-z0-9_-]{11}$");
  private static final List<Pattern> URL_PATTERNS = List.of(
      Pattern.compile("[?&]v=([A-Za-z0-9_-]{11})"),
      Pattern.compile("youtu\\.be/([A-Za-z0-9_-]{11})"),
      Pattern.compile("youtube\\.com/embed/([A-Za-z0-9_-]{11})"),
      Pattern.compile("youtube\\.com/shorts/([A-Za-z0-9_-]{11})"));

  /** Kept with the lesson so feedback on a summary can be checked against it. */
  static final int STORED_TRANSCRIPT = 8000;

  private final JdbcClient jdbc;
  private final Rows rows;
  private final JsonMapper json;
  private final YouTube youtube;

  public LessonService(JdbcClient jdbc, Rows rows, JsonMapper json, YouTube youtube) {
    this.jdbc = jdbc;
    this.rows = rows;
    this.json = json;
    this.youtube = youtube;
  }

  public static LocalDate today() {
    return LocalDate.now(BERLIN);
  }

  // ---------- Creating ----------

  /**
   * @param transcripts subtitles the coach has read in this run, by video id.
   *     Comprehension questions are accepted only for a video in here.
   */
  public Map<String, Object> createLesson(Learner learner, JsonNode input, String createdBy,
                                          Map<String, YouTube.Transcript> transcripts) {
    String dayText = str(input.get("day"));
    LocalDate day;
    try {
      day = dayText.isEmpty() ? today() : LocalDate.parse(dayText);
    } catch (RuntimeException e) {
      throw new UserError("day muss im Format JJJJ-MM-TT stehen.");
    }
    String title = str(input.get("title"));
    if (title.isEmpty()) throw new UserError("title fehlt.");

    Map<String, Object> listening = normalizeListening(input.get("listening"), transcripts, learner.course());
    Map<String, Object> writing = normalizeWriting(input.get("writing"));
    Map<String, Object> speaking = normalizeSpeaking(input.get("speaking"));
    Map<String, Object> sentences = normalizeSentences(input.get("sentences"), learner.course());
    if (listening == null && writing == null && speaking == null && sentences == null) {
      throw new UserError("Eine Lektion braucht mindestens einen Teil (listening, writing, speaking oder sentences).");
    }
    String level = str(input.get("level"));
    String status = str(input.get("status"));

    return rows.normalize(jdbc.sql("""
        INSERT INTO lessons (user_id, course, day, title, theme, level, created_by, status,
                             listening, writing, speaking, sentences)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT (user_id, course, day) DO UPDATE SET
          title = EXCLUDED.title, theme = EXCLUDED.theme, level = EXCLUDED.level,
          created_by = EXCLUDED.created_by, status = EXCLUDED.status,
          listening = EXCLUDED.listening, writing = EXCLUDED.writing,
          speaking = EXCLUDED.speaking, sentences = EXCLUDED.sentences
        RETURNING *""")
        .params(learner.userId(), learner.courseId(), day, title, str(input.get("theme")), level.isEmpty() ? "A2" : level, createdBy,
            status.isEmpty() ? "ready" : status, jsonbOrNull(listening), jsonbOrNull(writing),
            jsonbOrNull(speaking), jsonbOrNull(sentences))
        .query().singleRow());
  }

  /**
   * Two kinds of listening task. With comprehension questions (choice) the
   * app grades right away - but a model that has not read what is said in
   * the video would invent them, so questions need a transcript. Without
   * one, the learner summarizes what they understood and the coach gives
   * feedback later, as for writing.
   */
  private Map<String, Object> normalizeListening(JsonNode raw, Map<String, YouTube.Transcript> transcripts,
                                                 Course course) {
    if (raw == null || raw.isNull()) return null;
    String videoId = extractVideoId(str(raw.get("videoId")).isEmpty() ? str(raw.get("url")) : str(raw.get("videoId")));
    if (videoId == null) throw new UserError("listening braucht eine YouTube-URL oder eine 11-stellige videoId.");

    List<Map<String, Object>> questions = new ArrayList<>();
    JsonNode rawQuestions = raw.get("questions");
    if (rawQuestions != null && rawQuestions.isArray()) {
      for (int i = 0; i < Math.min(rawQuestions.size(), 10); i++) {
        JsonNode q = rawQuestions.get(i);
        String prompt = str(q.get("prompt"));
        List<String> options = strList(q.get("options"));
        String answer = str(q.get("answer"));
        if (prompt.isEmpty()) throw new UserError("Hörfrage " + (i + 1) + ": prompt fehlt.");
        if (options.size() < 2) throw new UserError("Hörfrage " + (i + 1) + ": mindestens zwei options nötig.");
        if (!options.contains(answer)) {
          throw new UserError("Hörfrage " + (i + 1) + ": answer \"" + answer + "\" ist keine der options.");
        }
        Map<String, Object> clean = new LinkedHashMap<>();
        clean.put("prompt", prompt);
        clean.put("options", options);
        clean.put("answer", answer);
        clean.put("explanation", str(q.get("explanation")));
        questions.add(clean);
      }
    }
    YouTube.Transcript transcript = transcripts.get(videoId);
    if (!questions.isEmpty() && transcript == null) {
      throw new UserError("Verständnisfragen gehen nur mit Transkript: erst get_video_transcript für " + videoId
          + " aufrufen. Gibt es keins, listening ohne questions anlegen - dann fasst der Lernende zusammen, "
          + "was er verstanden hat, und du gibst später Rückmeldung.");
    }
    Map<String, String> video = youtube.verify(videoId);

    Map<String, Object> out = new LinkedHashMap<>();
    out.put("videoId", videoId);
    out.put("videoTitle", video.get("title"));
    out.put("channel", video.get("channel"));
    out.put("url", "https://www.youtube.com/watch?v=" + videoId);
    String task = str(raw.get("task"));
    if (questions.isEmpty()) {
      int minWords = raw.path("minWords").asInt(0) == 0 ? 40 : raw.path("minWords").asInt();
      if (minWords < 10 || minWords > 300) throw new UserError("listening.minWords muss zwischen 10 und 300 liegen.");
      out.put("mode", "summary");
      out.put("task", task.isEmpty()
          ? "Sieh das Video und schreib " + course.inDe + ", was du verstanden hast: worum es geht, wer spricht, "
              + "was gesagt wird."
          : task);
      out.put("minWords", minWords);
    } else {
      out.put("mode", "questions");
      out.put("task", task.isEmpty() ? "Sieh das Video und beantworte die Fragen." : task);
      out.put("questions", questions);
    }
    if (transcript != null) {
      String text = transcript.text();
      out.put("transcript", text.length() > STORED_TRANSCRIPT ? text.substring(0, STORED_TRANSCRIPT) + " …" : text);
      out.put("transcriptAuto", transcript.autoGenerated());
    }
    return out;
  }

  private static Map<String, Object> normalizeWriting(JsonNode raw) {
    if (raw == null || raw.isNull()) return null;
    String prompt = str(raw.get("prompt"));
    if (prompt.isEmpty()) throw new UserError("writing braucht einen prompt.");
    int minWords = raw.path("minWords").asInt(0) == 0 ? 50 : raw.path("minWords").asInt();
    if (minWords < 10 || minWords > 500) throw new UserError("writing.minWords muss zwischen 10 und 500 liegen.");
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("prompt", prompt);
    out.put("targetWords", limit(strList(raw.get("targetWords")), 12));
    out.put("minWords", minWords);
    out.put("hints", limit(strList(raw.get("hints")), 6));
    return out;
  }

  private static Map<String, Object> normalizeSpeaking(JsonNode raw) {
    if (raw == null || raw.isNull()) return null;
    String topic = str(raw.get("topic"));
    if (topic.isEmpty()) throw new UserError("speaking braucht ein topic.");
    int minSeconds = raw.path("minSeconds").asInt(0) == 0 ? 60 : raw.path("minSeconds").asInt();
    if (minSeconds < 15 || minSeconds > 600) throw new UserError("speaking.minSeconds muss zwischen 15 und 600 liegen.");
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("topic", topic);
    out.put("prompts", limit(strList(raw.get("prompts")), 8));
    out.put("usefulPhrases", limit(strList(raw.get("usefulPhrases")), 12));
    out.put("minSeconds", minSeconds);
    return out;
  }

  /** Each sentence: German prompt and the intended solution (answer; "es" from older lessons). */
  private static Map<String, Object> normalizeSentences(JsonNode raw, Course course) {
    if (raw == null || raw.isNull()) return null;
    JsonNode items = raw.get("items");
    int n = items != null && items.isArray() ? items.size() : 0;
    if (n < 3 || n > 12) throw new UserError("sentences.items braucht zwischen 3 und 12 Sätze.");
    List<Map<String, Object>> clean = new ArrayList<>();
    for (int i = 0; i < n; i++) {
      JsonNode it = items.get(i);
      String de = str(it.get("de"));
      String answer = str(it.get("answer")).isEmpty() ? str(it.get("es")) : str(it.get("answer"));
      if (de.isEmpty()) throw new UserError("sentences.items[" + i + "].de fehlt (der deutsche Satz).");
      if (answer.isEmpty()) throw new UserError("sentences.items[" + i + "].answer fehlt (die gedachte Lösung).");
      Map<String, Object> s = new LinkedHashMap<>();
      s.put("de", de);
      s.put("answer", answer);
      s.put("note", str(it.get("note")));
      clean.add(s);
    }
    Map<String, Object> out = new LinkedHashMap<>();
    String task = str(raw.get("task"));
    out.put("task", task.isEmpty() ? "Übersetze die Sätze " + course.intoDe + "." : task);
    out.put("items", clean);
    return out;
  }

  // ---------- Video URLs ----------

  public static String extractVideoId(String input) {
    if (input == null || input.isBlank()) return null;
    String value = input.trim();
    if (BARE_ID.matcher(value).matches()) return value;
    for (Pattern p : URL_PATTERNS) {
      Matcher m = p.matcher(value);
      if (m.find()) return m.group(1);
    }
    return null;
  }

  // ---------- Reading and submitting ----------

  public Optional<Map<String, Object>> getLesson(Learner learner, LocalDate day) {
    return jdbc.sql("""
        SELECT l.*, (SELECT jsonb_object_agg(s.part, jsonb_build_object(
            'submittedAt', s.submitted_at, 'content', s.content,
            'feedback', s.feedback, 'feedbackAt', s.feedback_at))
          FROM lesson_submissions s WHERE s.lesson_id = l.id) AS submissions
        FROM lessons l WHERE l.user_id = ? AND l.course = ? AND l.day = ?""")
        .params(learner.userId(), learner.courseId(), day == null ? today() : day).query().listOfRows().stream()
        .findFirst().map(rows::normalize);
  }

  public List<Map<String, Object>> listLessons(Learner learner, int limit) {
    return rows.normalize(jdbc.sql("SELECT * FROM v_lesson_history WHERE user_id = ? AND course = ? LIMIT ?")
        .params(learner.userId(), learner.courseId(), limit).query().listOfRows());
  }

  public List<Map<String, Object>> pendingFeedback(Learner learner) {
    return rows.normalize(jdbc.sql("SELECT * FROM v_pending_feedback WHERE user_id = ? AND course = ?")
        .params(learner.userId(), learner.courseId()).query().listOfRows());
  }

  public Map<String, Object> submit(Learner learner, long lessonId, String part, JsonNode content) {
    Optional<Map<String, Object>> row = jdbc.sql("""
        INSERT INTO lesson_submissions (lesson_id, part, content)
        SELECT id, ?, ? FROM lessons WHERE id = ? AND user_id = ? AND course = ?
        RETURNING id, submitted_at""")
        .params(part, rows.jsonb(content == null ? json.createObjectNode() : content), lessonId,
            learner.userId(), learner.courseId())
        .query().listOfRows().stream().findFirst().map(rows::normalize);
    return row.orElseThrow(() -> new UserError("Keine Lektion mit id " + lessonId + "."));
  }

  public Map<String, Object> giveFeedback(Learner learner, long submissionId, String feedback, String by) {
    return jdbc.sql("""
        UPDATE lesson_submissions s SET feedback = ?, feedback_by = ?, feedback_at = now()
        FROM lessons l WHERE s.id = ? AND l.id = s.lesson_id AND l.user_id = ? AND l.course = ?
        RETURNING s.id, s.part""")
        .params(feedback, by, submissionId, learner.userId(), learner.courseId()).query().listOfRows().stream().findFirst()
        .map(rows::normalize)
        .orElseThrow(() -> new UserError("Keine Abgabe mit id " + submissionId + "."));
  }

  // ---------- Helpers ----------

  private Object jsonbOrNull(Object value) {
    return value == null ? null : rows.jsonb(value);
  }

  static String str(JsonNode v) {
    return v != null && v.isString() ? v.asString().trim() : "";
  }

  static List<String> strList(JsonNode v) {
    List<String> out = new ArrayList<>();
    if (v != null && v.isArray()) {
      for (JsonNode n : v) {
        String s = str(n);
        if (!s.isEmpty()) out.add(s);
      }
    }
    return out;
  }

  private static List<String> limit(List<String> list, int n) {
    return list.size() > n ? list.subList(0, n) : list;
  }
}
