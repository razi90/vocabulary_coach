package com.vocabcoach.learning;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;

/**
 * Validation of exercise sets ("packs"). A port of {@code parse} in
 * web/src/packs.js - the browser validates the same way when it plays a set,
 * so the rules must match. PackValidatorTest pins them down.
 *
 * <p>A set with a few broken items is still accepted; the broken items drop
 * out and are reported. A model must not be able to bring the app to a halt,
 * but it must learn what it got wrong.
 */
@Component
public class PackValidator {

  public static final String SCHEMA = "vocab-coach/exercise-pack@1";
  public static final List<String> ITEM_TYPES = List.of("choice", "cloze", "translate");
  static final int MAX_ITEMS = 100;

  public record Pack(String id, String title, String description, String createdBy, List<String> focus,
                     List<Map<String, Object>> items) {}

  public record Result(Pack pack, List<String> errors) {
    public boolean ok() {
      return pack != null;
    }
  }

  public Result parse(JsonNode raw, String source) {
    List<String> errors = new ArrayList<>();
    if (raw == null || !raw.isObject()) return fail(source + ": kein JSON-Objekt");
    String schema = str(raw.get("schema"));
    if (!SCHEMA.equals(schema)) {
      return fail(source + ": schema muss \"" + SCHEMA + "\" sein (war: " + (schema.isEmpty() ? "fehlt" : schema) + ")");
    }
    String id = str(raw.get("id"));
    if (id.isEmpty()) return fail(source + ": id fehlt");
    JsonNode rawItems = raw.get("items");
    if (rawItems == null || !rawItems.isArray() || rawItems.isEmpty()) {
      return fail(source + ": items fehlt oder ist leer");
    }

    List<Map<String, Object>> items = new ArrayList<>();
    for (int i = 0; i < Math.min(rawItems.size(), MAX_ITEMS); i++) {
      JsonNode rawItem = rawItems.get(i);
      String type = str(rawItem == null ? null : rawItem.get("type"));
      if (type.isEmpty()) type = "choice";
      if (!ITEM_TYPES.contains(type)) {
        errors.add(source + ": Aufgabe " + (i + 1) + " hat unbekannten type \"" + type + "\"");
        continue;
      }
      Map<String, Object> item = normalize(type, rawItem);
      String problem = validate(type, item);
      if (problem != null) {
        errors.add(source + ": Aufgabe " + (i + 1) + " (" + type + ") – " + problem);
        continue;
      }
      items.add(item);
    }
    if (rawItems.size() > MAX_ITEMS) errors.add(source + ": nur die ersten " + MAX_ITEMS + " Aufgaben werden genutzt");
    if (items.isEmpty()) {
      if (errors.isEmpty()) errors.add(source + ": keine gültige Aufgabe");
      return new Result(null, errors);
    }

    String title = str(raw.get("title"));
    String createdBy = str(raw.get("createdBy"));
    return new Result(new Pack(id, title.isEmpty() ? id : title, str(raw.get("description")),
        createdBy.isEmpty() ? "unbekannt" : createdBy, strList(raw.get("focus")), items), errors);
  }

  private static Map<String, Object> normalize(String type, JsonNode raw) {
    Map<String, Object> it = new LinkedHashMap<>();
    it.put("type", type);
    it.put("prompt", str(raw.get("prompt")));
    switch (type) {
      case "choice" -> {
        it.put("options", strList(raw.get("options")));
        it.put("answer", str(raw.get("answer")));
        it.put("explanation", str(raw.get("explanation")));
        it.put("lang", orDefault(str(raw.get("lang")), "es"));
      }
      case "cloze" -> {
        it.put("answer", str(raw.get("answer")));
        it.put("alternatives", strList(raw.get("alternatives")));
        it.put("hint", str(raw.get("hint")));
        it.put("explanation", str(raw.get("explanation")));
        it.put("lang", orDefault(str(raw.get("lang")), "es"));
      }
      default -> {
        it.put("answer", str(raw.get("answer")));
        it.put("alternatives", strList(raw.get("alternatives")));
        it.put("from", orDefault(str(raw.get("from")), "de"));
        it.put("to", orDefault(str(raw.get("to")), "es"));
        it.put("explanation", str(raw.get("explanation")));
      }
    }
    return it;
  }

  @SuppressWarnings("unchecked")
  private static String validate(String type, Map<String, Object> it) {
    String prompt = (String) it.get("prompt");
    String answer = (String) it.get("answer");
    if (prompt.isEmpty()) return "prompt fehlt";
    switch (type) {
      case "choice" -> {
        List<String> options = (List<String>) it.get("options");
        if (options.size() < 2) return "mindestens zwei options nötig";
        if (options.size() > 6) return "höchstens sechs options";
        if (answer.isEmpty()) return "answer fehlt";
        if (!options.contains(answer)) return "answer \"" + answer + "\" ist keine der options";
      }
      case "cloze" -> {
        if (!prompt.contains("___")) return "prompt braucht eine Lücke (___)";
        if (answer.isEmpty()) return "answer fehlt";
      }
      default -> {
        if (answer.isEmpty()) return "answer fehlt";
      }
    }
    return null;
  }

  private static Result fail(String message) {
    return new Result(null, List.of(message));
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

  private static String orDefault(String s, String fallback) {
    return s.isEmpty() ? fallback : s;
  }
}
