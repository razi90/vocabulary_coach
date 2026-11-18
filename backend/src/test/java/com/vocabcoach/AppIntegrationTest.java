package com.vocabcoach;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import com.vocabcoach.coach.LlmClient;
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

  /** A browser: its own cookie jar, sends the CSRF header like web/src/store.js. */
  class Learner {
    final CookieManager cookies = new CookieManager();
    final HttpClient http = HttpClient.newBuilder().cookieHandler(cookies).build();

    HttpResponse<String> send(String method, String path, Object body) throws Exception {
      HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
          .method(method, body == null ? HttpRequest.BodyPublishers.noBody()
              : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
      if (body != null) b.header("Content-Type", "application/json");
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
