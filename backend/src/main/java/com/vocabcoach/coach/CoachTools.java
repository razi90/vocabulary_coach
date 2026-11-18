package com.vocabcoach.coach;

import com.vocabcoach.UserError;
import com.vocabcoach.learning.Briefing;
import com.vocabcoach.learning.LearningStore;
import com.vocabcoach.learning.PackValidator;
import com.vocabcoach.lessons.LessonService;
import com.vocabcoach.lessons.YouTube;
import java.io.IOException;
import java.io.InputStream;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * The coach's tools: what the model may read and write.
 *
 * <p>Names, descriptions and parameter schemas live in coach/tools.json (they
 * are what the model reads, and German like everything the learner sees);
 * the handlers live here. Every handler gets the learner's id from the run,
 * never from the model - a tool call cannot reach another learner's data.
 */
@Component
public class CoachTools {

  /**
   * Who is being coached, by which model (recorded as the author), and the
   * video transcripts read during this run.
   */
  public record Context(long userId, String model, Map<String, YouTube.Transcript> transcripts) {
    public Context(long userId, String model) {
      this(userId, model, new ConcurrentHashMap<>());
    }
  }

  /** Transcript text handed to the model; a long video is cut here. */
  static final int TRANSCRIPT_FOR_MODEL = 15_000;

  @FunctionalInterface
  interface Handler {
    Object call(Context ctx, JsonNode args);
  }

  private final LearningStore store;
  private final LessonService lessons;
  private final PackValidator packs;
  private final YouTube youtube;
  private final JsonMapper json;
  private final ArrayNode definitions;
  private final Map<String, Handler> handlers = new LinkedHashMap<>();

  public CoachTools(LearningStore store, LessonService lessons, PackValidator packs, YouTube youtube,
                    JsonMapper json) throws IOException {
    this.store = store;
    this.lessons = lessons;
    this.packs = packs;
    this.youtube = youtube;
    this.json = json;
    try (InputStream in = new ClassPathResource("coach/tools.json").getInputStream()) {
      this.definitions = (ArrayNode) json.readTree(in);
    }
    register();
    for (JsonNode d : definitions) {
      if (!handlers.containsKey(d.path("name").asString())) {
        throw new IllegalStateException("Werkzeug ohne Handler: " + d.path("name").asString());
      }
    }
  }

  /** The tool list in Chat Completions format. Video search only if the server has a key. */
  public ArrayNode chatTools() {
    ArrayNode out = json.createArrayNode();
    for (JsonNode d : definitions) {
      if ("search_youtube".equals(d.path("name").asString()) && !youtube.searchAvailable()) continue;
      ObjectNode fn = json.createObjectNode();
      fn.put("name", d.path("name").asString());
      fn.put("description", d.path("description").asString());
      fn.set("parameters", d.path("parameters"));
      out.addObject().put("type", "function").set("function", fn);
    }
    return out;
  }

  /**
   * Runs one tool call. Domain errors come back as text for the model to
   * correct - that is how a rejected exercise gets fixed.
   */
  public Outcome call(Context ctx, String name, String rawArgs) {
    Handler h = handlers.get(name);
    if (h == null) return Outcome.error("Unbekanntes Werkzeug: " + name);
    JsonNode args;
    try {
      args = rawArgs == null || rawArgs.isBlank() ? json.createObjectNode() : json.readTree(rawArgs);
    } catch (RuntimeException e) {
      return Outcome.error("Die Argumente sind kein gültiges JSON: " + e.getMessage());
    }
    if (!args.isObject()) return Outcome.error("Die Argumente müssen ein JSON-Objekt sein.");
    try {
      Object value = h.call(ctx, args);
      return Outcome.ok(value instanceof String s ? s : json.writerWithDefaultPrettyPrinter().writeValueAsString(value));
    } catch (UserError e) {
      return Outcome.error(e.getMessage());
    }
  }

  public record Outcome(boolean ok, String text) {
    static Outcome ok(String text) {
      return new Outcome(true, text);
    }

    static Outcome error(String text) {
      return new Outcome(false, text);
    }
  }

  // ---------- Handlers ----------

  private void register() {
    handlers.put("get_briefing", (ctx, a) ->
        Briefing.toMarkdown(store.weaknesses(ctx.userId(), clamp(a, "days", 30, 1, 3650), 12)));

    handlers.put("get_weaknesses", (ctx, a) ->
        store.weaknesses(ctx.userId(), clamp(a, "days", 30, 1, 3650), clamp(a, "limit", 12, 1, 100)));

    handlers.put("query_events", (ctx, a) -> store.getEvents(ctx.userId(), text(a, "kind"),
        a.hasNonNull("since") ? a.get("since").asLong() : null, clamp(a, "limit", 200, 1, 5000)));

    handlers.put("search_vocabulary", (ctx, a) -> store.searchVocabulary(ctx.userId(), text(a, "search"),
        text(a, "topic"), text(a, "level"), text(a, "pos"), clamp(a, "limit", 50, 1, 500)));

    handlers.put("list_exercises", (ctx, a) -> {
      String status = text(a, "status");
      Map<String, Map<String, Object>> results = store.exerciseResults(ctx.userId());
      return store.getExercises(ctx.userId(), status == null ? "all" : status).stream().map(e -> {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", e.get("id"));
        out.put("title", e.get("title"));
        out.put("status", e.get("status"));
        out.put("createdBy", e.get("createdBy"));
        out.put("createdAt", e.get("createdAt"));
        out.put("items", e.get("items") instanceof JsonNode n ? n.size() : 0);
        Map<String, Object> r = results.get((String) e.get("id"));
        out.put("results", r == null ? null : Map.of(
            "attempts", r.get("attempts"),
            "accuracy", r.get("accuracy") == null ? "–" : r.get("accuracy"),
            "lastPractised", r.get("last_practised") == null ? "nie" : r.get("last_practised")));
        return out;
      }).toList();
    });

    handlers.put("create_exercise", (ctx, a) -> {
      ObjectNode raw = json.createObjectNode();
      raw.put("schema", PackValidator.SCHEMA);
      raw.set("id", a.get("id"));
      raw.set("title", a.get("title"));
      raw.put("description", a.path("description").asString(""));
      raw.put("createdBy", ctx.model());
      raw.set("focus", a.has("focus") ? a.get("focus") : json.createArrayNode());
      raw.set("items", a.get("items"));
      String id = a.path("id").asString("");
      PackValidator.Result r = packs.parse(raw, id.isEmpty() ? "Übungssatz" : id);
      if (!r.ok()) throw new UserError("Übungssatz abgelehnt:\n- " + String.join("\n- ", r.errors()));
      String status = "draft".equals(text(a, "status")) ? "draft" : "ready";
      PackValidator.Pack p = r.pack();
      store.upsertExercise(ctx.userId(), p.id(), PackValidator.SCHEMA, p.title(), p.description(), p.createdBy(),
          p.focus(), status, p.items());
      Map<String, Object> out = new LinkedHashMap<>();
      out.put("ok", true);
      out.put("id", p.id());
      out.put("status", status);
      out.put("accepted", p.items().size());
      if (!r.errors().isEmpty()) out.put("skipped", r.errors());
      out.put("note", "Der Satz steht sofort im Tab „Übungen“ der App.");
      return out;
    });

    handlers.put("set_exercise_status", (ctx, a) -> {
      String id = required(a, "id");
      String status = required(a, "status");
      if (!LearningStore.EXERCISE_STATUSES.contains(status)) throw new UserError("status muss ready, draft oder archived sein.");
      if (!store.setExerciseStatus(ctx.userId(), id, status)) throw new UserError("Kein Übungssatz mit id \"" + id + "\".");
      return Map.of("ok", true, "id", id, "status", status);
    });

    handlers.put("delete_exercise", (ctx, a) -> {
      String id = required(a, "id");
      if (!store.deleteExercise(ctx.userId(), id)) throw new UserError("Kein Übungssatz mit id \"" + id + "\".");
      return Map.of("ok", true, "id", id);
    });

    handlers.put("search_youtube", (ctx, a) -> {
      List<YouTube.Video> found = youtube.search(required(a, "query"), text(a, "duration"),
          !a.has("withCaptions") || a.get("withCaptions").asBoolean(true), clamp(a, "maxResults", 6, 1, 10));
      if (found.isEmpty()) {
        return "Keine Treffer. Andere Suchbegriffe versuchen, oder withCaptions=false bzw. eine andere duration.";
      }
      return found.stream().map(YouTube::describe).toList();
    });

    handlers.put("get_video_transcript", (ctx, a) -> {
      String id = LessonService.extractVideoId(required(a, "videoId"));
      if (id == null) throw new UserError("videoId ist keine gültige YouTube-ID oder -URL.");
      YouTube.Transcript t = youtube.transcript(id).orElseThrow(() -> new UserError(
          "Für dieses Video gibt es kein spanisches Transkript (oder YouTube gibt es nicht heraus). "
              + "Lege listening ohne questions an: Der Lernende fasst zusammen, was er verstanden hat."));
      ctx.transcripts().put(id, t);
      Map<String, Object> out = new LinkedHashMap<>();
      out.put("videoId", id);
      out.put("sprache", t.language());
      out.put("automatisch", t.autoGenerated()
          ? "ja - automatisch erzeugt, kann Fehler enthalten; frag nur nach eindeutig Gesagtem" : "nein");
      out.put("transkript", t.text().length() > TRANSCRIPT_FOR_MODEL
          ? t.text().substring(0, TRANSCRIPT_FOR_MODEL) + "\n… (gekürzt - Fragen nur zum Teil oben stellen)"
          : t.text());
      return out;
    });

    handlers.put("create_lesson", (ctx, a) -> {
      Map<String, Object> row = lessons.createLesson(ctx.userId(), a, ctx.model(), ctx.transcripts());
      Map<String, Object> out = new LinkedHashMap<>();
      out.put("ok", true);
      out.put("day", String.valueOf(row.get("day")));
      out.put("title", row.get("title"));
      out.put("teile", List.of("listening", "writing", "speaking", "sentences").stream()
          .filter(k -> row.get(k) != null).toList());
      if (row.get("listening") instanceof JsonNode l) {
        out.put("video", Map.of("id", l.path("videoId").asString(), "titel", l.path("videoTitle").asString(),
            "kanal", l.path("channel").asString(), "art", l.path("mode").asString()));
      }
      out.put("hinweis", "Die Lektion steht sofort im Tab „Lektion“ der App.");
      return out;
    });

    handlers.put("get_lesson", (ctx, a) -> {
      String day = text(a, "day");
      LocalDate d;
      try {
        d = day == null ? null : LocalDate.parse(day);
      } catch (RuntimeException e) {
        throw new UserError("day muss im Format JJJJ-MM-TT stehen.");
      }
      return lessons.getLesson(ctx.userId(), d)
          .<Object>map(l -> l).orElse(Map.of("hinweis", "Für diesen Tag gibt es keine Lektion."));
    });

    handlers.put("list_lessons", (ctx, a) -> lessons.listLessons(ctx.userId(), clamp(a, "limit", 30, 1, 100)));

    handlers.put("get_pending_feedback", (ctx, a) -> {
      List<Map<String, Object>> pending = lessons.pendingFeedback(ctx.userId());
      return pending.isEmpty() ? "Keine offenen Abgaben." : pending;
    });

    handlers.put("give_feedback", (ctx, a) -> {
      if (!a.hasNonNull("submissionId")) throw new UserError("submissionId fehlt.");
      String feedback = required(a, "feedback");
      Map<String, Object> row = lessons.giveFeedback(ctx.userId(), a.get("submissionId").asLong(), feedback, ctx.model());
      return Map.of("ok", true, "id", row.get("id"), "part", row.get("part"));
    });
  }

  // ---------- Argument helpers ----------

  private static String text(JsonNode a, String field) {
    JsonNode v = a.get(field);
    return v != null && v.isString() && !v.asString().isBlank() ? v.asString().trim() : null;
  }

  private static String required(JsonNode a, String field) {
    String v = text(a, field);
    if (v == null) throw new UserError(field + " fehlt.");
    return v;
  }

  private static int clamp(JsonNode a, String field, int fallback, int min, int max) {
    JsonNode v = a.get(field);
    int n = v != null && v.isNumber() ? v.asInt() : fallback;
    return Math.max(min, Math.min(max, n));
  }

}
