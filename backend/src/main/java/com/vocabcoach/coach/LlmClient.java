package com.vocabcoach.coach;

import com.vocabcoach.UserError;
import com.vocabcoach.config.AppProperties;
import java.io.IOException;
import java.net.ProxySelector;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * A minimal OpenAI-compatible Chat Completions client with tool calling.
 *
 * <p>Deliberately hand-written instead of a framework abstraction: the key
 * differs per learner and per request, and the coach loop needs to see each
 * step to record it. That is about a hundred lines on top of the JDK client.
 */
@Component
public class LlmClient {

  public record Reply(ObjectNode message, String finishReason, int promptTokens, int completionTokens) {
    public ArrayNode toolCalls() {
      JsonNode calls = message.get("tool_calls");
      return calls instanceof ArrayNode a ? a : null;
    }

    public String text() {
      JsonNode content = message.get("content");
      return content != null && content.isString() ? content.asString() : "";
    }
  }

  public record Model(String id, String name) {}

  /** The model or provider refused; the message is meant for the learner. */
  public static class LlmException extends UserError {
    public LlmException(String message) {
      super(message);
    }
  }

  private final HttpClient http;
  private final JsonMapper json;
  private final Duration timeout;
  private final Map<Provider, CachedModels> modelCache = new ConcurrentHashMap<>();

  private record CachedModels(List<Model> models, Instant until) {}

  public LlmClient(JsonMapper json, AppProperties props) {
    this.json = json;
    this.timeout = props.coach() == null ? Duration.ofSeconds(180) : props.coach().requestTimeout();
    this.http = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(15))
        // Respect https.proxyHost & co. - the JDK client ignores them otherwise.
        .proxy(ProxySelector.getDefault())
        .build();
  }

  public Reply chat(CoachSettings.Credentials c, ArrayNode messages, ArrayNode tools) {
    ObjectNode body = json.createObjectNode();
    body.put("model", c.model());
    body.set("messages", messages);
    if (tools != null && !tools.isEmpty()) {
      body.set("tools", tools);
      body.put("tool_choice", "auto");
    }
    JsonNode res = post(c, json.writeValueAsString(body));

    JsonNode choice = res.path("choices").path(0);
    if (!(choice.get("message") instanceof ObjectNode message)) {
      throw new LlmException("Antwort des Modells ohne Inhalt: " + shorten(res.toString(), 300));
    }
    JsonNode usage = res.path("usage");
    return new Reply(message, choice.path("finish_reason").asString(""),
        usage.path("prompt_tokens").asInt(0), usage.path("completion_tokens").asInt(0));
  }

  private JsonNode post(CoachSettings.Credentials c, String body) {
    HttpRequest req = HttpRequest.newBuilder(URI.create(c.provider().chatUrl))
        .timeout(timeout)
        .header("Authorization", "Bearer " + c.apiKey())
        .header("Content-Type", "application/json")
        // OpenRouter shows this name in the learner's activity list.
        .header("X-Title", "Vokabeltrainer")
        .POST(HttpRequest.BodyPublishers.ofString(body))
        .build();
    HttpResponse<String> res = send(req, c.provider());
    JsonNode parsed = parse(res.body());
    if (res.statusCode() >= 400 || (parsed.has("error") && !parsed.has("choices"))) {
      throw new LlmException(describe(c.provider(), res.statusCode(), parsed, res.body()));
    }
    return parsed;
  }

  /**
   * Models that can call tools, sorted by name. Only the list fetched without
   * a key is cached (an hour, shared by everyone); a list fetched with a
   * learner's key depends on that key and is never handed to anyone else.
   */
  public List<Model> models(Provider p, String apiKey) {
    if (apiKey == null) {
      CachedModels cached = modelCache.get(p);
      if (cached != null && cached.until().isAfter(Instant.now())) return cached.models();
    }

    HttpRequest.Builder req = HttpRequest.newBuilder(URI.create(p.modelsUrl)).timeout(Duration.ofSeconds(20)).GET();
    if (apiKey != null) req.header("Authorization", "Bearer " + apiKey);
    HttpResponse<String> res = send(req.build(), p);
    if (res.statusCode() >= 400) {
      throw new LlmException(describe(p, res.statusCode(), parse(res.body()), res.body()));
    }
    List<Model> models = new ArrayList<>();
    for (JsonNode m : parse(res.body()).path("data")) {
      String id = m.path("id").asString("");
      if (id.isEmpty() || !usable(p, m)) continue;
      models.add(new Model(id, m.path("name").asString(id)));
    }
    models.sort(Comparator.comparing(Model::name, String.CASE_INSENSITIVE_ORDER));
    if (apiKey == null) modelCache.put(p, new CachedModels(models, Instant.now().plus(Duration.ofHours(1))));
    return models;
  }

  /** A chat model that can call tools and that this app may use. */
  static boolean usable(Provider p, JsonNode m) {
    if (m.has("type") && !"chat".equals(m.path("type").asString())) return false;
    if (m.path("capabilities").path("tools").path("supported").asBoolean(true) == false) return false;
    if (p == Provider.OPENCODE_ZEN) {
      // Zen's free models answer only to OpenCode itself; other clients get 403.
      JsonNode text = m.path("cost").path("text");
      boolean free = text.path("input").path("price").asDouble(-1) == 0
          && text.path("output").path("price").asDouble(-1) == 0;
      if (free) return false;
    }
    return true;
  }

  /** Throws with a readable message if the provider rejects the key. */
  public void checkKey(Provider p, String apiKey) {
    if (p.keyCheckUrl == null) return;
    HttpRequest req = HttpRequest.newBuilder(URI.create(p.keyCheckUrl)).timeout(Duration.ofSeconds(20))
        .header("Authorization", "Bearer " + apiKey).GET().build();
    HttpResponse<String> res = send(req, p);
    if (res.statusCode() >= 400) throw new LlmException(describe(p, res.statusCode(), parse(res.body()), res.body()));
  }

  private HttpResponse<String> send(HttpRequest req, Provider p) {
    try {
      return http.send(req, HttpResponse.BodyHandlers.ofString());
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new LlmException("Abgebrochen.");
    } catch (java.net.http.HttpTimeoutException e) {
      throw new LlmException(p.label + " hat nicht rechtzeitig geantwortet.");
    } catch (IOException e) {
      throw new LlmException(p.label + " ist nicht erreichbar: " + e.getMessage());
    }
  }

  private JsonNode parse(String body) {
    try {
      return body == null || body.isBlank() ? json.createObjectNode() : json.readTree(body);
    } catch (JacksonException e) {
      return json.createObjectNode().put("raw", shorten(body, 300));
    }
  }

  static String describe(Provider p, int status, JsonNode body, String raw) {
    JsonNode err = body.path("error");
    String detail = err.isString() ? err.asString() : err.path("message").asString("");
    if (detail.isEmpty()) detail = shorten(raw, 200);
    String reason = switch (status) {
      case 401, 403 -> "Der API-Schlüssel wurde abgelehnt.";
      case 402 -> "Das Guthaben bei " + p.label + " ist aufgebraucht.";
      case 404 -> "Das Modell gibt es bei " + p.label + " nicht (mehr).";
      case 429 -> p.label + " drosselt gerade die Anfragen. Bitte etwas später erneut versuchen.";
      default -> status >= 500 ? p.label + " hat einen Fehler gemeldet." : "Anfrage abgelehnt.";
    };
    return reason + (detail.isBlank() ? "" : " (" + detail + ")");
  }

  static String shorten(String s, int max) {
    if (s == null) return "";
    return s.length() <= max ? s : s.substring(0, max) + "…";
  }
}
