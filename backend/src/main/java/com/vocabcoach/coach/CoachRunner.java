package com.vocabcoach.coach;

import com.vocabcoach.UserError;
import com.vocabcoach.config.AppProperties;
import com.vocabcoach.db.Rows;
import com.vocabcoach.learning.Course;
import com.vocabcoach.learning.Learner;
import com.vocabcoach.lessons.LessonService;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * Runs the coach: the model gets the task, calls tools until it is done, and
 * every step is written to coach_runs so the app can show it live.
 *
 * <p>Runs execute in the background on virtual threads; the request that
 * starts one returns at once. One run per learner at a time.
 */
@Service
public class CoachRunner implements ApplicationRunner {

  private static final Logger log = LoggerFactory.getLogger(CoachRunner.class);
  public static final Set<String> TASKS = Set.of("exercises", "lesson", "feedback", "custom");
  private static final Duration MAX_RUN_TIME = Duration.ofMinutes(10);
  private static final int MAX_TOOL_RESULT = 30_000;
  private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("EEEE, d. MMMM yyyy", Locale.GERMAN);

  private final JdbcClient jdbc;
  private final Rows rows;
  private final JsonMapper json;
  private final CoachSettings settings;
  private final CoachTools tools;
  private final LlmClient llm;
  private final int maxSteps;
  /** The coach instructions per course, assembled once at startup. */
  private final Map<Course, String> systemPrompts = new java.util.EnumMap<>(Course.class);
  private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();

  public CoachRunner(JdbcClient jdbc, Rows rows, JsonMapper json, CoachSettings settings, CoachTools tools,
                     LlmClient llm, AppProperties props) throws IOException {
    this.jdbc = jdbc;
    this.rows = rows;
    this.json = json;
    this.settings = settings;
    this.tools = tools;
    this.llm = llm;
    this.maxSteps = props.coach() == null ? 25 : props.coach().maxSteps();
    String base = resource("coach/system-prompt.md");
    for (Course course : Course.values()) {
      systemPrompts.put(course, systemPrompt(base, resource("coach/course-" + course.id + ".md"), course));
    }
  }

  /**
   * The shared instructions with the course part inserted. The course file
   * starts with a comment of "key: value" lines that fill the {{key}}
   * placeholders; a placeholder left over is a bug and stops the startup.
   */
  static String systemPrompt(String base, String courseFile, Course course) {
    Map<String, String> values = new LinkedHashMap<>();
    String body = courseFile;
    if (courseFile.startsWith("<!--")) {
      int end = courseFile.indexOf("-->");
      for (String line : courseFile.substring(4, end).split("\n")) {
        int colon = line.indexOf(':');
        if (colon > 0) {
          values.put(line.substring(0, colon).trim(), line.substring(colon + 1).trim());
        }
      }
      body = courseFile.substring(end + 3).strip();
    }
    String prompt = base.replace("{{course}}", body);
    for (var e : values.entrySet()) prompt = prompt.replace("{{" + e.getKey() + "}}", e.getValue());
    prompt = course.fill(prompt);
    int open = prompt.indexOf("{{");
    if (open >= 0) {
      throw new IllegalStateException("Platzhalter ohne Wert im Coach-Prompt (" + course.id + "): "
          + prompt.substring(open, Math.min(prompt.length(), open + 30)));
    }
    return prompt;
  }

  private static String resource(String path) throws IOException {
    try (InputStream in = new ClassPathResource(path).getInputStream()) {
      return new String(in.readAllBytes(), StandardCharsets.UTF_8);
    }
  }

  /** Runs that were in flight when the server stopped will never finish. */
  @Override
  public void run(ApplicationArguments args) {
    int n = jdbc.sql("""
        UPDATE coach_runs SET status = 'failed', error = 'Der Server wurde während des Laufs neu gestartet.',
          finished_at = now() WHERE status = 'running'""").update();
    if (n > 0) log.info("{} unterbrochene Coach-Läufe als fehlgeschlagen markiert", n);
  }

  // ---------- Starting ----------

  public Map<String, Object> start(Learner learner, String task, String note) {
    long userId = learner.userId();
    if (!TASKS.contains(task)) throw new UserError("Unbekannte Aufgabe: " + task);
    String cleanNote = note == null ? "" : note.trim();
    if (cleanNote.length() > 2000) throw new UserError("Der Hinweis ist zu lang (höchstens 2000 Zeichen).");
    if ("custom".equals(task) && cleanNote.isEmpty()) throw new UserError("Bitte schreib, was der Coach tun soll.");

    CoachSettings.Credentials creds = settings.credentials(userId);
    // Check and insert in one statement: one running job per learner.
    Long id = jdbc.sql("""
        INSERT INTO coach_runs (user_id, course, task, note, provider, model)
        SELECT ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (SELECT 1 FROM coach_runs WHERE user_id = ? AND status = 'running')
        RETURNING id""")
        .params(userId, learner.courseId(), task, cleanNote, creds.provider().id, creds.model(), userId)
        .query(Long.class).optional().orElse(null);
    if (id == null) throw new UserError("Der Coach arbeitet schon. Bitte warte, bis der laufende Auftrag fertig ist.");

    long runId = id;
    executor.submit(() -> execute(runId, learner, task, cleanNote, creds));
    return find(userId, runId).orElseThrow();
  }

  // ---------- The loop ----------

  void execute(long runId, Learner learner, String task, String note, CoachSettings.Credentials creds) {
    Instant deadline = Instant.now().plus(MAX_RUN_TIME);
    List<Map<String, Object>> steps = new ArrayList<>();
    int promptTokens = 0;
    int completionTokens = 0;
    CoachTools.Context ctx = new CoachTools.Context(learner, creds.model());
    ArrayNode messages = json.createArrayNode();
    messages.addObject().put("role", "system").put("content", systemPrompts.get(learner.course()));
    messages.addObject().put("role", "user").put("content", taskMessage(task, note));
    ArrayNode toolDefs = tools.chatTools(learner.course());

    try {
      for (int round = 1; ; round++) {
        if (round > maxSteps) {
          throw new UserError("Abgebrochen nach " + maxSteps + " Schritten - das Modell kam zu keinem Ende.");
        }
        if (Instant.now().isAfter(deadline)) throw new UserError("Abgebrochen: Der Lauf dauerte länger als 10 Minuten.");

        LlmClient.Reply reply = llm.chat(creds, messages, toolDefs);
        promptTokens += reply.promptTokens();
        completionTokens += reply.completionTokens();
        messages.add(reply.message());

        ArrayNode calls = reply.toolCalls();
        if (calls == null || calls.isEmpty()) {
          String summary = reply.text().isBlank() ? "(Das Modell hat keine Zusammenfassung geschrieben.)" : reply.text().trim();
          finish(runId, "done", steps, summary, null, promptTokens, completionTokens);
          return;
        }
        if (!reply.text().isBlank()) steps.add(step("message", null, reply.text().trim(), true, null));

        for (JsonNode call : calls) {
          String name = call.path("function").path("name").asString("");
          String args = call.path("function").path("arguments").asString("");
          CoachTools.Outcome outcome = tools.call(ctx, name, args);
          String result = outcome.text().length() > MAX_TOOL_RESULT
              ? outcome.text().substring(0, MAX_TOOL_RESULT) + "\n… (gekürzt - mit limit oder Filtern genauer fragen)"
              : outcome.text();
          ObjectNode toolMsg = messages.addObject();
          toolMsg.put("role", "tool");
          toolMsg.put("tool_call_id", call.path("id").asString(""));
          toolMsg.put("name", name);
          toolMsg.put("content", outcome.ok() ? result : "FEHLER: " + result);
          steps.add(step("tool", name, LlmClient.shorten(outcome.text(), 600), outcome.ok(), LlmClient.shorten(args, 400)));
        }
        progress(runId, steps, promptTokens, completionTokens);
      }
    } catch (UserError e) {
      finish(runId, "failed", steps, null, e.getMessage(), promptTokens, completionTokens);
    } catch (RuntimeException e) {
      log.error("Coach-Lauf {} fehlgeschlagen", runId, e);
      finish(runId, "failed", steps, null, "Interner Fehler: " + e.getMessage(), promptTokens, completionTokens);
    }
  }

  static String taskMessage(String task, String note) {
    String today = LessonService.today().format(DAY);
    String body = switch (task) {
      case "exercises" -> "Aufgabe: Erstelle neue Übungssätze zu meinen aktuellen Schwächen.";
      case "lesson" -> "Aufgabe: Erstelle die Tageslektion für heute.";
      case "feedback" -> "Aufgabe: Gib Rückmeldung zu allen offenen Abgaben (get_pending_feedback). "
          + "Lege nichts Neues an.";
      default -> "Aufgabe: siehe Hinweis.";
    };
    StringBuilder sb = new StringBuilder("Heute ist ").append(today).append(".\n\n").append(body);
    if (!note.isEmpty()) sb.append("\n\nHinweis des Lernenden:\n").append(note);
    return sb.toString();
  }

  private static Map<String, Object> step(String kind, String tool, String text, boolean ok, String args) {
    Map<String, Object> s = new LinkedHashMap<>();
    s.put("kind", kind);
    if (tool != null) s.put("tool", tool);
    if (args != null) s.put("args", args);
    s.put("ok", ok);
    s.put("text", text);
    s.put("at", Instant.now().toString());
    return s;
  }

  private void progress(long runId, List<Map<String, Object>> steps, int prompt, int completion) {
    jdbc.sql("UPDATE coach_runs SET steps = ?, prompt_tokens = ?, completion_tokens = ? WHERE id = ?")
        .params(rows.jsonb(steps), prompt, completion, runId).update();
  }

  private void finish(long runId, String status, List<Map<String, Object>> steps, String summary, String error,
                      int prompt, int completion) {
    jdbc.sql("""
        UPDATE coach_runs SET status = ?, steps = ?, summary = ?, error = ?, prompt_tokens = ?,
          completion_tokens = ?, finished_at = now() WHERE id = ?""")
        .params(status, rows.jsonb(steps), summary, error, prompt, completion, runId).update();
  }

  // ---------- Reading ----------

  /** The learner's runs in their current course. */
  public List<Map<String, Object>> list(Learner learner, int limit) {
    return rows.normalize(jdbc.sql("SELECT * FROM coach_runs WHERE user_id = ? AND course = ? ORDER BY started_at DESC LIMIT ?")
        .params(learner.userId(), learner.courseId(), limit).query().listOfRows());
  }

  public java.util.Optional<Map<String, Object>> find(long userId, long id) {
    return jdbc.sql("SELECT * FROM coach_runs WHERE user_id = ? AND id = ?").params(userId, id)
        .query().listOfRows().stream().findFirst().map(rows::normalize);
  }
}
