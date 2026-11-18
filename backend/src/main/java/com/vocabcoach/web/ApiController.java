package com.vocabcoach.web;

import com.vocabcoach.UserError;
import com.vocabcoach.auth.CurrentUser;
import com.vocabcoach.learning.Briefing;
import com.vocabcoach.learning.LearningStore;
import com.vocabcoach.learning.PackValidator;
import com.vocabcoach.lessons.LessonService;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import tools.jackson.databind.JsonNode;

/**
 * The app's API. Same routes and shapes as the former Node server, now
 * scoped to the logged-in learner.
 */
@RestController
@RequestMapping("/api")
public class ApiController {

  private static final Set<String> PARTS = Set.of("listening", "writing", "speaking", "sentences");

  private final LearningStore store;
  private final LessonService lessons;
  private final PackValidator packs;
  private final LiveUpdates live;

  public ApiController(LearningStore store, LessonService lessons, PackValidator packs, LiveUpdates live) {
    this.store = store;
    this.lessons = lessons;
    this.packs = packs;
    this.live = live;
  }

  @GetMapping(path = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
  public SseEmitter stream() {
    return live.open(CurrentUser.id());
  }

  @GetMapping("/snapshot")
  public Map<String, Object> snapshot() {
    long user = CurrentUser.id();
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("state", store.getSettings(user));
    out.put("cards", store.getCards(user));
    out.put("events", store.getEvents(user, null, null, null));
    out.put("packs", store.getExercises(user, "ready"));
    out.put("packErrors", List.of());
    return out;
  }

  @PutMapping("/state")
  public Map<String, Object> putState(@RequestBody JsonNode body) {
    if (body == null || !body.isObject()) throw new UserError("state erwartet");
    store.putSettings(CurrentUser.id(), body);
    return Map.of("ok", true);
  }

  @PatchMapping("/cards")
  public Map<String, Object> patchCards(@RequestBody JsonNode body) {
    if (body == null || !body.isObject()) throw new UserError("Karten erwartet");
    return Map.of("ok", true, "written", store.upsertCards(CurrentUser.id(), body));
  }

  @PostMapping("/events")
  public Map<String, Object> postEvents(@RequestBody JsonNode body) {
    List<Long> seqs = store.appendEvents(CurrentUser.id(), body);
    if (seqs.isEmpty()) throw new UserError("kein gültiges Ereignis");
    return Map.of("seqs", seqs);
  }

  @GetMapping("/events")
  public List<Map<String, Object>> events(@RequestParam(required = false) String kind,
                                          @RequestParam(required = false) Long since,
                                          @RequestParam(required = false) Integer limit) {
    return store.getEvents(CurrentUser.id(), kind, since, limit);
  }

  @GetMapping("/packs")
  public Map<String, Object> getPacks() {
    return Map.of("packs", store.getExercises(CurrentUser.id(), "ready"), "errors", List.of());
  }

  /** Import from the app: the same validation as for the coach. */
  @PostMapping("/packs")
  public ResponseEntity<Map<String, Object>> importPack(@RequestBody JsonNode body) {
    JsonNode raw = body != null && body.has("raw") ? body.get("raw") : body;
    PackValidator.Result r = packs.parse(raw, "Import");
    if (!r.ok()) {
      return ResponseEntity.badRequest().body(Map.of("error", "Übungssatz ungültig", "errors", r.errors()));
    }
    PackValidator.Pack p = r.pack();
    long user = CurrentUser.id();
    store.upsertExercise(user, p.id(), PackValidator.SCHEMA, p.title(), p.description(), p.createdBy(), p.focus(),
        "ready", p.items());
    Map<String, Object> saved = store.getExercises(user, "all").stream()
        .filter(x -> p.id().equals(x.get("id"))).findFirst().orElse(Map.of());
    return ResponseEntity.ok(Map.of("ok", true, "exercise", saved, "errors", r.errors()));
  }

  @DeleteMapping("/packs/{id}")
  public Map<String, Object> deletePack(@PathVariable String id) {
    store.deleteExercise(CurrentUser.id(), id);
    return Map.of("ok", true);
  }

  // ---------- Lessons ----------

  @GetMapping("/lesson")
  public ResponseEntity<?> lesson(@RequestParam(required = false) LocalDate day) {
    var lesson = lessons.getLesson(CurrentUser.id(), day);
    // The app reads the body as JSON; without a lesson that is a literal null.
    return lesson.<ResponseEntity<?>>map(ResponseEntity::ok)
        .orElseGet(() -> ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body("null"));
  }

  @PostMapping("/lesson/{id}/submit")
  public Map<String, Object> submit(@PathVariable long id, @RequestBody JsonNode body) {
    String part = body == null ? "" : body.path("part").asString("");
    if (!PARTS.contains(part)) throw new UserError("part muss listening, writing, speaking oder sentences sein");
    Map<String, Object> row = lessons.submit(CurrentUser.id(), id, part, body.get("content"));
    return Map.of("ok", true, "id", row.get("id"), "submittedAt", row.get("submitted_at"));
  }

  // ---------- Analysis ----------

  @GetMapping("/weaknesses")
  public Map<String, Object> weaknesses(@RequestParam(defaultValue = "30") int days,
                                        @RequestParam(defaultValue = "12") int limit) {
    return store.weaknesses(CurrentUser.id(), Math.max(1, days), Math.max(1, Math.min(limit, 100)));
  }

  @GetMapping(path = "/briefing", produces = "text/markdown;charset=UTF-8")
  public String briefing(@RequestParam(defaultValue = "30") int days) {
    return Briefing.toMarkdown(store.weaknesses(CurrentUser.id(), Math.max(1, days), 12));
  }
}
