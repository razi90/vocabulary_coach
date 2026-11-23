package com.vocabcoach;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

import com.vocabcoach.coach.LlmClient;
import com.vocabcoach.lessons.YouTube;
import java.net.CookieManager;
import java.net.HttpCookie;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.postgresql.PostgreSQLContainer;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * The whole app over HTTP against a real Postgres: login and CSRF, learners
 * that cannot see each other's data, and a coach run with a scripted model.
 *
 * <p>Uses Testcontainers when Docker is available. Without Docker, point
 * TEST_DATABASE_URL (plus TEST_DATABASE_USER / TEST_DATABASE_PASSWORD) at an
 * empty database; without either, the test is skipped.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "app.encryption-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    "app.registration-code=test-code",
    "app.admin-email=",
    "spring.web.resources.static-locations=file:../web/"})
@EnabledIf("databaseAvailable")
class AppIntegrationTest {

  static PostgreSQLContainer postgres;

  static boolean databaseAvailable() {
    return System.getenv("TEST_DATABASE_URL") != null || DockerClientFactory.instance().isDockerAvailable();
  }

  @DynamicPropertySource
  static void database(DynamicPropertyRegistry r) {
    String url = System.getenv("TEST_DATABASE_URL");
    if (url != null) {
      r.add("spring.datasource.url", () -> url);
      r.add("spring.datasource.username", () -> env("TEST_DATABASE_USER", "voco"));
      r.add("spring.datasource.password", () -> env("TEST_DATABASE_PASSWORD", ""));
      return;
    }
    postgres = new PostgreSQLContainer("postgres:17-alpine");
    postgres.start();
    r.add("spring.datasource.url", postgres::getJdbcUrl);
    r.add("spring.datasource.username", postgres::getUsername);
    r.add("spring.datasource.password", postgres::getPassword);
  }

  private static String env(String name, String fallback) {
    String v = System.getenv(name);
    return v == null ? fallback : v;
  }

  @Value("${local.server.port}")
  int port;

  @Autowired
  JsonMapper json;

  @Autowired
  JdbcClient jdbc;

  @MockitoBean
  LlmClient llm;

  @MockitoBean
  YouTube youtube;

  /** A browser: its own cookie jar, sends the CSRF header like web/src/store.js. */
  class Learner {
    final CookieManager cookies = new CookieManager();
    final HttpClient http = HttpClient.newBuilder().cookieHandler(cookies).build();
    /** The course the "page" was loaded for, sent as X-Course like store.js; null: none. */
    String course;

    HttpResponse<String> send(String method, String path, Object body) throws Exception {
      HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
          .method(method, body == null ? HttpRequest.BodyPublishers.noBody()
              : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
      if (body != null) b.header("Content-Type", "application/json");
      if (course != null) b.header("X-Course", course);
      String token = csrf();
      if (!method.equals("GET") && token != null) b.header("X-XSRF-TOKEN", token);
      return http.send(b.build(), HttpResponse.BodyHandlers.ofString());
    }

    JsonNode ok(String method, String path, Object body) throws Exception {
      HttpResponse<String> res = send(method, path, body);
      assertThat(res.statusCode()).as(method + " " + path + ": " + res.body()).isBetween(200, 299);
      return json.readTree(res.body());
    }

    String csrf() {
      return cookies.getCookieStore().getCookies().stream().filter(c -> c.getName().equals("XSRF-TOKEN"))
          .map(HttpCookie::getValue).findFirst().orElse(null);
    }

    Learner register(String email) throws Exception {
      ok("GET", "/api/auth/config", null);   // fetches the CSRF cookie
      ok("POST", "/api/auth/register", json.createObjectNode()
          .put("email", email).put("password", "ein-langes-passwort").put("code", "test-code"));
      return this;
    }
  }

  private static String unique(String name) {
    return name + "-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
  }

  @Test
  void loginAndCsrfAreEnforced() throws Exception {
    Learner anon = new Learner();
    assertThat(anon.send("GET", "/api/snapshot", null).statusCode()).isEqualTo(401);
    assertThat(anon.send("GET", "/", null).statusCode()).isEqualTo(302);

    Learner a = new Learner().register(unique("a"));
    assertThat(a.ok("GET", "/api/auth/me", null).path("email").asString()).startsWith("a-");

    // A write without the CSRF header is refused even with a valid session.
    HttpResponse<String> forged = a.http.send(HttpRequest.newBuilder(
            URI.create("http://localhost:" + port + "/api/events"))
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString("{\"kind\":\"vocab\",\"ok\":true}")).build(),
        HttpResponse.BodyHandlers.ofString());
    assertThat(forged.statusCode()).isEqualTo(403);

    Learner wrongCode = new Learner();
    wrongCode.ok("GET", "/api/auth/config", null);
    assertThat(wrongCode.send("POST", "/api/auth/register", json.createObjectNode()
        .put("email", unique("x")).put("password", "ein-langes-passwort").put("code", "falsch")).statusCode())
        .isEqualTo(400);
  }

  @Test
  void learnersOnlySeeTheirOwnState() throws Exception {
    Learner a = new Learner().register(unique("a"));
    Learner b = new Learner().register(unique("b"));

    a.ok("POST", "/api/events", json.readTree("""
        {"kind":"vocab","ok":false,"id":"la puerta","typed":"die Verspätung"}"""));
    a.ok("POST", "/api/packs", json.readTree("""
        {"schema":"vocab-coach/exercise-pack@1","id":"nur-a","title":"Nur A",
         "items":[{"type":"translate","prompt":"Haus","answer":"casa"}]}"""));

    assertThat(a.ok("GET", "/api/packs", null).path("packs")).hasSize(1);
    assertThat(b.ok("GET", "/api/packs", null).path("packs")).isEmpty();
    assertThat(a.ok("GET", "/api/events", null)).hasSize(1);
    assertThat(b.ok("GET", "/api/events", null)).isEmpty();
    // B deleting A's set is a no-op.
    b.ok("DELETE", "/api/packs/nur-a", null);
    assertThat(a.ok("GET", "/api/packs", null).path("packs")).hasSize(1);

    String briefing = a.send("GET", "/api/briefing", null).body();
    assertThat(briefing).contains("la puerta").contains("verwechselt mit el retraso");
    assertThat(b.send("GET", "/api/briefing", null).body()).doesNotContain("la puerta");
  }

  @Test
  void aStaleTabKeepsWritingIntoItsOwnCourse() throws Exception {
    // One session, two tabs: the course header is what tells them apart.
    Learner a = new Learner().register(unique("course"));
    a.ok("PUT", "/api/auth/course", json.createObjectNode().put("course", "en"));   // switched on the laptop

    a.course = "es";                           // the phone still shows Spanish
    a.ok("POST", "/api/events", json.readTree("""
        {"kind":"vocab","ok":false,"id":"la puerta","typed":"el retraso"}"""));
    assertThat(a.ok("GET", "/api/events", null)).hasSize(1);

    a.course = "en";
    assertThat(a.ok("GET", "/api/events", null)).isEmpty();
    a.course = null;                           // no header: the account's course, now English
    assertThat(a.ok("GET", "/api/events", null)).isEmpty();
  }

  @Test
  void aStoredKeyIsNeverUsedForAnotherProvider() throws Exception {
    Learner a = new Learner().register(unique("key"));
    long userId = a.ok("GET", "/api/auth/me", null).path("id").asLong();
    a.ok("PUT", "/api/coach/settings", json.createObjectNode()
        .put("provider", "openrouter").put("model", "test/model").put("apiKey", "sk-or-v1-0123456789abcd"));

    // Same provider, no new key: the key stays.
    a.ok("PUT", "/api/coach/settings", json.createObjectNode().put("provider", "openrouter").put("model", "other/model"));
    // Another provider without a key: refused, and the OpenRouter key is untouched.
    HttpResponse<String> res = a.send("PUT", "/api/coach/settings",
        json.createObjectNode().put("provider", "opencode_zen").put("model", "test/model"));
    assertThat(res.statusCode()).as(res.body()).isEqualTo(400);
    assertThat(jdbc.sql("SELECT provider FROM coach_settings WHERE user_id = ?").param(userId)
        .query(String.class).single()).isEqualTo("openrouter");
    assertThat(a.ok("GET", "/api/coach/settings", null).path("hasKey").asBoolean()).isTrue();
  }

  @Test
  void coachRunFixesARejectedExerciseAndFinishes() throws Exception {
    Learner a = new Learner().register(unique("coach"));
    long userId = a.ok("GET", "/api/auth/me", null).path("id").asLong();

    JsonNode saved = a.ok("PUT", "/api/coach/settings", json.createObjectNode()
        .put("provider", "openrouter").put("model", "test/model").put("apiKey", "sk-or-v1-0123456789abcd"));
    assertThat(saved.path("hasKey").asBoolean()).isTrue();
    assertThat(saved.path("keyHint").asString()).isEqualTo("…abcd");
    assertThat(saved.has("apiKey")).isFalse();
    byte[] stored = jdbc.sql("SELECT api_key_enc FROM coach_settings WHERE user_id = ?").param(userId)
        .query(byte[].class).single();
    assertThat(new String(stored, java.nio.charset.StandardCharsets.ISO_8859_1)).doesNotContain("0123456789abcd");

    // The scripted model: a broken set, then the fixed one, then a summary.
    String broken = """
        {"id":"ser-estar","title":"Ser oder estar","items":[
          {"type":"choice","prompt":"Madrid ___ en España.","options":["es","está"],"answer":"esta"}]}""";
    String fixed = """
        {"id":"ser-estar","title":"Ser oder estar","focus":["ser_estar"],"items":[
          {"type":"choice","prompt":"Madrid ___ en España.","options":["es","está"],"answer":"está",
           "explanation":"Ort → estar"}]}""";
    List<ArrayNode> seen = new ArrayList<>();
    AtomicInteger round = new AtomicInteger();
    when(llm.chat(any(), any(), any())).thenAnswer(inv -> {
      seen.add(((ArrayNode) inv.getArgument(1)).deepCopy());
      return switch (round.incrementAndGet()) {
        case 1 -> toolCall("call_1", "create_exercise", broken);
        case 2 -> toolCall("call_2", "create_exercise", fixed);
        default -> new LlmClient.Reply(json.createObjectNode().put("role", "assistant")
            .put("content", "Ein Satz zu ser und estar liegt bereit."), "stop", 100, 20);
      };
    });

    JsonNode run = a.ok("POST", "/api/coach/runs", json.createObjectNode().put("task", "exercises"));
    long runId = run.path("id").asLong();
    JsonNode done = waitFor(a, runId);

    assertThat(done.path("status").asString()).as(done.toString()).isEqualTo("done");
    assertThat(done.path("summary").asString()).isEqualTo("Ein Satz zu ser und estar liegt bereit.");
    assertThat(done.path("steps")).hasSize(2);
    assertThat(done.path("steps").get(0).path("ok").asBoolean()).isFalse();
    assertThat(done.path("steps").get(1).path("ok").asBoolean()).isTrue();
    assertThat(done.path("prompt_tokens").asInt()).isEqualTo(300);

    // The rejection was fed back to the model, with the reason.
    JsonNode toolReply = seen.get(1).get(seen.get(1).size() - 1);
    assertThat(toolReply.path("role").asString()).isEqualTo("tool");
    assertThat(toolReply.path("content").asString()).contains("FEHLER").contains("ist keine der options");

    JsonNode packs = a.ok("GET", "/api/packs", null).path("packs");
    assertThat(packs).hasSize(1);
    assertThat(packs.get(0).path("createdBy").asString()).isEqualTo("test/model");

    // Another learner cannot read the run.
    Learner b = new Learner().register(unique("other"));
    assertThat(b.send("GET", "/api/coach/runs/" + runId, null).statusCode()).isEqualTo(404);
  }

  @Test
  void coachNeedsSettingsFirst() throws Exception {
    Learner a = new Learner().register(unique("nosetup"));
    HttpResponse<String> res = a.send("POST", "/api/coach/runs", json.createObjectNode().put("task", "exercises"));
    assertThat(res.statusCode()).isEqualTo(400);
    assertThat(res.body()).contains("noch nicht eingerichtet");
  }

  /** Words in a course's deck, from the content the server loads (it grows with the course). */
  private int deckSize(String course) throws Exception {
    try (var in = getClass().getResourceAsStream("/content/content.json")) {
      return json.readTree(in).path(course).path("vocabulary").size();
    }
  }

  @Test
  void eachCourseKeepsItsOwnProgress() throws Exception {
    Learner a = new Learner().register(unique("courses"));
    assertThat(a.ok("GET", "/api/auth/me", null).path("course").asString()).isEqualTo("es");
    a.ok("POST", "/api/events", json.readTree("""
        {"kind":"vocab","ok":false,"id":"la puerta","typed":"die Verspätung"}"""));
    a.ok("PUT", "/api/state", json.readTree("{\"streak\":5}"));

    assertThat(a.ok("PUT", "/api/auth/course", json.createObjectNode().put("course", "en"))
        .path("course").asString()).isEqualTo("en");
    assertThat(a.ok("GET", "/api/events", null)).isEmpty();
    assertThat(a.ok("GET", "/api/snapshot", null).path("state")).isEmpty();
    a.ok("POST", "/api/events", json.readTree("""
        {"kind":"vocab","ok":false,"id":"to become","typed":"bekommen"}"""));
    a.ok("PATCH", "/api/cards", json.readTree("{\"to become\":{\"id\":\"to become\",\"state\":\"learning\"}}"));
    a.ok("PATCH", "/api/cards", json.readTree("{\"la puerta\":{\"id\":\"la puerta\",\"state\":\"learning\"}}"));
    assertThat(a.ok("GET", "/api/snapshot", null).path("cards").properties()).hasSize(1)
        .as("a Spanish word is no card in the English course");
    String english = a.send("GET", "/api/briefing", null).body();
    assertThat(english).contains(deckSize("en") + " Vokabeln").contains("to become").doesNotContain("la puerta");

    a.ok("PUT", "/api/auth/course", json.createObjectNode().put("course", "es"));
    assertThat(a.ok("GET", "/api/events", null)).hasSize(1);
    assertThat(a.ok("GET", "/api/snapshot", null).path("state").path("streak").asInt()).isEqualTo(5);
    assertThat(a.send("GET", "/api/briefing", null).body()).contains(deckSize("es") + " Vokabeln").contains("la puerta");

    assertThat(a.send("PUT", "/api/auth/course", json.createObjectNode().put("course", "fr")).statusCode())
        .isEqualTo(400);
  }

  @Test
  void theEnglishCoachGetsEnglishInstructionsAndTools() throws Exception {
    Learner a = new Learner();
    a.ok("GET", "/api/auth/config", null);
    a.ok("POST", "/api/auth/register", json.createObjectNode().put("email", unique("english"))
        .put("password", "ein-langes-passwort").put("code", "test-code").put("course", "en"));
    assertThat(a.ok("GET", "/api/auth/me", null).path("course").asString()).isEqualTo("en");
    a.ok("PUT", "/api/coach/settings", json.createObjectNode()
        .put("provider", "openrouter").put("model", "test/model").put("apiKey", "sk-or-v1-0123456789abcd"));
    when(youtube.searchAvailable()).thenReturn(true);
    List<ArrayNode> calls = new ArrayList<>();
    List<ArrayNode> toolLists = new ArrayList<>();
    AtomicInteger round = new AtomicInteger();
    when(llm.chat(any(), any(), any())).thenAnswer(inv -> {
      calls.add(((ArrayNode) inv.getArgument(1)).deepCopy());
      toolLists.add(inv.getArgument(2));
      if (round.getAndIncrement() == 0) return toolCall("c1", "create_exercise", """
          {"id":"since-for","title":"since oder for","items":[
            {"type":"cloze","prompt":"I have lived here ___ 2015.","answer":"since"},
            {"type":"translate","prompt":"Ich wohne seit zehn Jahren hier.","answer":"I have lived here for ten years."}]}""");
      return new LlmClient.Reply(json.createObjectNode().put("role", "assistant").put("content", "Fertig."), "stop", 1, 1);
    });
    JsonNode run = waitFor(a, a.ok("POST", "/api/coach/runs", json.createObjectNode().put("task", "exercises")).path("id").asLong());
    assertThat(run.path("status").asString()).as(run.toString()).isEqualTo("done");
    assertThat(run.path("course").asString()).isEqualTo("en");

    String system = calls.get(0).get(0).path("content").asString();
    assertThat(system).contains("English coach").contains("false_friends").doesNotContain("ser_estar");
    assertThat(toolLists.get(0).toString()).contains("englischsprachige").doesNotContain("spanisch");

    JsonNode items = a.ok("GET", "/api/packs", null).path("packs").get(0).path("items");
    assertThat(items.get(0).path("lang").asString()).isEqualTo("en");
    assertThat(items.get(1).path("to").asString()).isEqualTo("en");
    // The Spanish side of the same account has no exercises.
    a.ok("PUT", "/api/auth/course", json.createObjectNode().put("course", "es"));
    assertThat(a.ok("GET", "/api/packs", null).path("packs")).isEmpty();
  }

  /** Scripts the model: each element is either a tool call (name, args) or the final text. */
  private void script(String... steps) {
    AtomicInteger round = new AtomicInteger();
    when(llm.chat(any(), any(), any())).thenAnswer(inv -> {
      int i = round.getAndIncrement();
      if (i * 2 + 1 < steps.length) return toolCall("call_" + i, steps[i * 2], steps[i * 2 + 1]);
      return new LlmClient.Reply(json.createObjectNode().put("role", "assistant")
          .put("content", steps[steps.length - 1]), "stop", 10, 10);
    });
  }

  private Learner coachedLearner(String name) throws Exception {
    Learner a = new Learner().register(unique(name));
    a.ok("PUT", "/api/coach/settings", json.createObjectNode()
        .put("provider", "openrouter").put("model", "test/model").put("apiKey", "sk-or-v1-0123456789abcd"));
    when(youtube.verify(anyString())).thenReturn(Map.of("title", "En el mercado", "channel", "Español Fácil"));
    return a;
  }

  private static final String WITH_QUESTIONS = """
      {"title":"Im Markt","listening":{"videoId":"abcdefghijk","questions":[
        {"prompt":"¿Qué compra Ana?","options":["Pan","Fruta"],"answer":"Fruta"}]}}""";

  @Test
  void listeningQuestionsNeedATranscriptFromTheSameRun() throws Exception {
    Learner a = coachedLearner("listen");
    when(youtube.transcript("abcdefghijk", "es"))
        .thenReturn(Optional.of(new YouTube.Transcript("es", false, "Ana compra fruta en el mercado.")));
    script("create_lesson", WITH_QUESTIONS,
        "get_video_transcript", "{\"videoId\":\"https://youtu.be/abcdefghijk\"}",
        "create_lesson", WITH_QUESTIONS,
        "Lektion steht.");

    JsonNode run = waitFor(a, a.ok("POST", "/api/coach/runs", json.createObjectNode().put("task", "lesson")).path("id").asLong());
    assertThat(run.path("status").asString()).as(run.toString()).isEqualTo("done");
    JsonNode steps = run.path("steps");
    assertThat(steps.get(0).path("ok").asBoolean()).isFalse();
    assertThat(steps.get(0).path("text").asString()).contains("get_video_transcript");
    assertThat(steps.get(1).path("ok").asBoolean()).isTrue();
    assertThat(steps.get(2).path("ok").asBoolean()).isTrue();

    JsonNode listening = a.ok("GET", "/api/lesson", null).path("listening");
    assertThat(listening.path("mode").asString()).isEqualTo("questions");
    assertThat(listening.path("videoTitle").asString()).isEqualTo("En el mercado");
    assertThat(listening.has("transcript")).as("answer key stays on the server").isFalse();
  }

  @Test
  void withoutTranscriptTheListeningTaskIsOpenAndWaitsForFeedback() throws Exception {
    Learner a = coachedLearner("summary");
    when(youtube.transcript(anyString(), anyString())).thenReturn(Optional.empty());
    script("get_video_transcript", "{\"videoId\":\"abcdefghijk\"}",
        "create_lesson", "{\"title\":\"Im Markt\",\"listening\":{\"videoId\":\"abcdefghijk\",\"minWords\":20}}",
        "Offene Höraufgabe angelegt.");

    JsonNode run = waitFor(a, a.ok("POST", "/api/coach/runs", json.createObjectNode().put("task", "lesson")).path("id").asLong());
    assertThat(run.path("status").asString()).as(run.toString()).isEqualTo("done");
    assertThat(run.path("steps").get(0).path("text").asString()).contains("kein Transkript");

    JsonNode lesson = a.ok("GET", "/api/lesson", null);
    assertThat(lesson.path("listening").path("mode").asString()).isEqualTo("summary");
    assertThat(lesson.path("listening").path("minWords").asInt()).isEqualTo(20);
    a.ok("POST", "/api/lesson/" + lesson.path("id").asLong() + "/submit", json.readTree("""
        {"part":"listening","content":{"text":"Ana va al mercado y compra fruta.","words":7}}"""));

    long userId = a.ok("GET", "/api/auth/me", null).path("id").asLong();
    List<String> pending = jdbc.sql("SELECT part FROM v_pending_feedback WHERE user_id = ?").param(userId)
        .query(String.class).list();
    assertThat(pending).containsExactly("listening");
  }

  @Test
  void videoSearchIsOnlyOfferedWithAKey() throws Exception {
    Learner a = coachedLearner("search");
    when(youtube.searchAvailable()).thenReturn(false);
    List<ArrayNode> toolLists = new ArrayList<>();
    when(llm.chat(any(), any(), any())).thenAnswer(inv -> {
      toolLists.add(inv.getArgument(2));
      return new LlmClient.Reply(json.createObjectNode().put("role", "assistant").put("content", "ok"), "stop", 1, 1);
    });
    waitFor(a, a.ok("POST", "/api/coach/runs", json.createObjectNode().put("task", "lesson")).path("id").asLong());
    when(youtube.searchAvailable()).thenReturn(true);
    waitFor(a, a.ok("POST", "/api/coach/runs", json.createObjectNode().put("task", "lesson")).path("id").asLong());

    assertThat(names(toolLists.get(0))).doesNotContain("search_youtube");
    assertThat(names(toolLists.get(1))).contains("search_youtube");
  }

  @Test
  void subtitlesAreOnlyOfferedWhileTheyCanBeRead() throws Exception {
    Learner a = coachedLearner("subtitles");
    List<ArrayNode> toolLists = new ArrayList<>();
    when(llm.chat(any(), any(), any())).thenAnswer(inv -> {
      toolLists.add(inv.getArgument(2));
      return new LlmClient.Reply(json.createObjectNode().put("role", "assistant").put("content", "ok"), "stop", 1, 1);
    });
    when(youtube.transcriptsAvailable()).thenReturn(false);
    waitFor(a, a.ok("POST", "/api/coach/runs", json.createObjectNode().put("task", "lesson")).path("id").asLong());
    when(youtube.transcriptsAvailable()).thenReturn(true);
    waitFor(a, a.ok("POST", "/api/coach/runs", json.createObjectNode().put("task", "lesson")).path("id").asLong());

    assertThat(names(toolLists.get(0))).doesNotContain("get_video_transcript");
    assertThat(names(toolLists.get(1))).contains("get_video_transcript");
  }

  @Test
  void severalWordsAreCheckedInOneCall() throws Exception {
    Learner a = coachedLearner("terms");
    List<String> toolReplies = new ArrayList<>();
    AtomicInteger round = new AtomicInteger();
    when(llm.chat(any(), any(), any())).thenAnswer(inv -> {
      ArrayNode messages = inv.getArgument(1);
      messages.forEach(m -> { if ("tool".equals(m.path("role").asString())) toolReplies.add(m.path("content").asString()); });
      if (round.getAndIncrement() == 0) {
        return toolCall("call_0", "search_vocabulary", "{\"terms\":[\"casa\",\"el perro\",\"xyzzy\"]}");
      }
      return new LlmClient.Reply(json.createObjectNode().put("role", "assistant").put("content", "ok"), "stop", 1, 1);
    });
    waitFor(a, a.ok("POST", "/api/coach/runs", json.createObjectNode().put("task", "exercises")).path("id").asLong());

    JsonNode result = json.readTree(toolReplies.get(toolReplies.size() - 1));
    assertThat(result).hasSize(3);
    assertThat(result.get(0).path("query").asString()).isEqualTo("casa");
    assertThat(result.get(0).path("found").get(0).path("term").asString()).isEqualTo("la casa");   // exact word first
    assertThat(result.get(1).path("found").get(0).path("term").asString()).isEqualTo("el perro");
    assertThat(result.get(2).path("found")).isEmpty();
    assertThat(result.get(2).path("note").asString()).isEqualTo("nicht im Kurs");
  }

  private static List<String> names(ArrayNode tools) {
    List<String> out = new ArrayList<>();
    tools.forEach(t -> out.add(t.path("function").path("name").asString()));
    return out;
  }

  private LlmClient.Reply toolCall(String id, String name, String args) {
    ObjectNode msg = json.createObjectNode().put("role", "assistant");
    msg.putNull("content");
    ObjectNode call = msg.putArray("tool_calls").addObject().put("id", id).put("type", "function");
    call.putObject("function").put("name", name).put("arguments", args);
    return new LlmClient.Reply(msg, "tool_calls", 100, 50);
  }

  private JsonNode waitFor(Learner a, long runId) throws Exception {
    Instant until = Instant.now().plus(Duration.ofSeconds(15));
    while (Instant.now().isBefore(until)) {
      JsonNode run = a.ok("GET", "/api/coach/runs/" + runId, null);
      if (!"running".equals(run.path("status").asString())) return run;
      Thread.sleep(100);
    }
    throw new AssertionError("Lauf " + runId + " wurde nicht fertig");
  }
}
