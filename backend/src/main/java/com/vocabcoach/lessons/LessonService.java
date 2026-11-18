package com.vocabcoach.lessons;

import com.vocabcoach.UserError;

import com.vocabcoach.db.Rows;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
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
 * checked against the oEmbed endpoint on creation and the lesson rejected
 * otherwise. Title and channel come from the same response.
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

  private final JdbcClient jdbc;
  private final Rows rows;
  private final JsonMapper json;
  private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(8))
      .followRedirects(HttpClient.Redirect.NORMAL).proxy(java.net.ProxySelector.getDefault()).build();

  public LessonService(JdbcClient jdbc, Rows rows, JsonMapper json) {
    this.jdbc = jdbc;
    this.rows = rows;
    this.json = json;
  }

  public static LocalDate today() {
    return LocalDate.now(BERLIN);
  }

  // ---------- Creating ----------

  public Map<String, Object> createLesson(long userId, JsonNode input, String createdBy) {
    String dayText = str(input.get("day"));
    LocalDate day;
    try {
      day = dayText.isEmpty() ? today() : LocalDate.parse(dayText);
    } catch (RuntimeException e) {
      throw new UserError("day muss im Format JJJJ-MM-TT stehen.");
    }
    String title = str(input.get("title"));
    if (title.isEmpty()) throw new UserError("title fehlt.");

    Map<String, Object> listening = normalizeListening(input.get("listening"));
    Map<String, Object> writing = normalizeWriting(input.get("writing"));
    Map<String, Object> speaking = normalizeSpeaking(input.get("speaking"));
    Map<String, Object> sentences = normalizeSentences(input.get("sentences"));
    if (listening == null && writing == null && speaking == null && sentences == null) {
      throw new UserError("Eine Lektion braucht mindestens einen Teil (listening, writing, speaking oder sentences).");
    }
    String level = str(input.get("level"));
    String status = str(input.get("status"));

    return rows.normalize(jdbc.sql("""
        INSERT INTO lessons (user_id, day, title, theme, level, created_by, status,
                             listening, writing, speaking, sentences)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT (user_id, day) DO UPDATE SET
          title = EXCLUDED.title, theme = EXCLUDED.theme, level = EXCLUDED.level,
          created_by = EXCLUDED.created_by, status = EXCLUDED.status,
          listening = EXCLUDED.listening, writing = EXCLUDED.writing,
          speaking = EXCLUDED.speaking, sentences = EXCLUDED.sentences
        RETURNING *""")
        .params(userId, day, title, str(input.get("theme")), level.isEmpty() ? "A2" : level, createdBy,
            status.isEmpty() ? "ready" : status, jsonbOrNull(listening), jsonbOrNull(writing),
            jsonbOrNull(speaking), jsonbOrNull(sentences))
        .query().singleRow());
  }

  private Map<String, Object> normalizeListening(JsonNode raw) {
    if (raw == null || raw.isNull()) return null;
    String videoId = extractVideoId(str(raw.get("videoId")).isEmpty() ? str(raw.get("url")) : str(raw.get("videoId")));
    if (videoId == null) throw new UserError("listening braucht eine YouTube-URL oder eine 11-stellige videoId.");
    Map<String, String> video = verifyVideo(videoId);

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
    if (questions.isEmpty()) throw new UserError("listening braucht mindestens eine Verständnisfrage.");

    Map<String, Object> out = new LinkedHashMap<>();
    out.put("videoId", videoId);
    out.put("videoTitle", video.get("title"));
    out.put("channel", video.get("channel"));
    out.put("url", "https://www.youtube.com/watch?v=" + videoId);
    String task = str(raw.get("task"));
    out.put("task", task.isEmpty() ? "Sieh das Video und beantworte die Fragen." : task);
    out.put("questions", questions);
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

  private static Map<String, Object> normalizeSentences(JsonNode raw) {
    if (raw == null || raw.isNull()) return null;
    JsonNode items = raw.get("items");
    int n = items != null && items.isArray() ? items.size() : 0;
    if (n < 3 || n > 12) throw new UserError("sentences.items braucht zwischen 3 und 12 Sätze.");
    List<Map<String, Object>> clean = new ArrayList<>();
    for (int i = 0; i < n; i++) {
      JsonNode it = items.get(i);
      String de = str(it.get("de"));
      String es = str(it.get("es"));
      if (de.isEmpty()) throw new UserError("sentences.items[" + i + "].de fehlt (der deutsche Satz).");
      if (es.isEmpty()) throw new UserError("sentences.items[" + i + "].es fehlt (die gedachte Lösung).");
      Map<String, Object> s = new LinkedHashMap<>();
      s.put("de", de);
      s.put("es", es);
      s.put("note", str(it.get("note")));
      clean.add(s);
    }
    Map<String, Object> out = new LinkedHashMap<>();
    String task = str(raw.get("task"));
    out.put("task", task.isEmpty() ? "Übersetze die Sätze ins Spanische." : task);
    out.put("items", clean);
    return out;
  }

  // ---------- The video check ----------

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

  Map<String, String> verifyVideo(String videoId) {
    String watch = "https://www.youtube.com/watch?v=" + videoId;
    URI uri = URI.create("https://www.youtube.com/oembed?url=" + URLEncoder.encode(watch, StandardCharsets.UTF_8)
        + "&format=json");
    HttpResponse<String> res;
    try {
      res = http.send(HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(8)).GET().build(),
          HttpResponse.BodyHandlers.ofString());
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new UserError("YouTube-Prüfung abgebrochen.");
    } catch (Exception e) {
      throw new UserError("YouTube war nicht erreichbar (" + e.getMessage() + "). Später erneut versuchen.");
    }
    int code = res.statusCode();
    if (code == 400 || code == 401 || code == 403 || code == 404) {
      throw new UserError("Das Video \"" + videoId + "\" gibt es nicht oder es lässt sich nicht einbetten. "
          + "Nimm nur eine URL, die der Lernende dir gegeben hat - nie eine aus dem Gedächtnis.");
    }
    if (code < 200 || code >= 300) throw new UserError("YouTube antwortete mit " + code + ".");
    JsonNode data = json.readTree(res.body());
    return Map.of("title", str(data.get("title")), "channel", str(data.get("author_name")));
  }

  // ---------- Reading and submitting ----------

  public Optional<Map<String, Object>> getLesson(long userId, LocalDate day) {
    return jdbc.sql("""
        SELECT l.*, (SELECT jsonb_object_agg(s.part, jsonb_build_object(
            'submittedAt', s.submitted_at, 'content', s.content,
            'feedback', s.feedback, 'feedbackAt', s.feedback_at))
          FROM lesson_submissions s WHERE s.lesson_id = l.id) AS submissions
        FROM lessons l WHERE l.user_id = ? AND l.day = ?""")
        .params(userId, day == null ? today() : day).query().listOfRows().stream()
        .findFirst().map(rows::normalize);
  }

  public List<Map<String, Object>> listLessons(long userId, int limit) {
    return rows.normalize(jdbc.sql("SELECT * FROM v_lesson_history WHERE user_id = ? LIMIT ?")
        .params(userId, limit).query().listOfRows());
  }

  public List<Map<String, Object>> pendingFeedback(long userId) {
    return rows.normalize(jdbc.sql("SELECT * FROM v_pending_feedback WHERE user_id = ?")
        .param(userId).query().listOfRows());
  }

  public Map<String, Object> submit(long userId, long lessonId, String part, JsonNode content) {
    Optional<Map<String, Object>> row = jdbc.sql("""
        INSERT INTO lesson_submissions (lesson_id, part, content)
        SELECT id, ?, ? FROM lessons WHERE id = ? AND user_id = ?
        RETURNING id, submitted_at""")
        .params(part, rows.jsonb(content == null ? json.createObjectNode() : content), lessonId, userId)
        .query().listOfRows().stream().findFirst().map(rows::normalize);
    return row.orElseThrow(() -> new UserError("Keine Lektion mit id " + lessonId + "."));
  }

  public Map<String, Object> giveFeedback(long userId, long submissionId, String feedback, String by) {
    return jdbc.sql("""
        UPDATE lesson_submissions s SET feedback = ?, feedback_by = ?, feedback_at = now()
        FROM lessons l WHERE s.id = ? AND l.id = s.lesson_id AND l.user_id = ?
        RETURNING s.id, s.part""")
        .params(feedback, by, submissionId, userId).query().listOfRows().stream().findFirst()
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
