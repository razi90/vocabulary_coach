package com.vocabcoach.learning;

import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

/**
 * Phrases the analysis as Markdown for the coach. Computes nothing - the
 * numbers come from the SQL views - so the app, the API and the coach can
 * never disagree.
 */
public final class Briefing {

  private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("dd.MM.yyyy");
  private static final ZoneId BERLIN = ZoneId.of("Europe/Berlin");

  private Briefing() {}

  @SuppressWarnings("unchecked")
  public static String toMarkdown(Map<String, Object> w) {
    List<String> out = new ArrayList<>();
    Map<String, Object> s = (Map<String, Object>) w.get("summary");
    int streak = num(s.get("streak"));

    out.add("# Lernstand — " + ZonedDateTime.now(BERLIN).format(DATE));
    out.add("");
    out.add(s.get("deck_size") + " Vokabeln · " + s.get("learned") + " gelernt · " + s.get("mature") + " reif · "
        + s.get("due_now") + " fällig · Serie " + streak + " " + (streak == 1 ? "Tag" : "Tage") + " · "
        + s.get("total_answers") + " Antworten insgesamt");
    out.add(s.get("accuracy_30d") == null
        ? "Noch keine Antworten in den letzten 30 Tagen."
        // Always the 30-day figure (v_summary), whatever window the rest of the briefing uses.
        : "Genauigkeit der letzten 30 Tage: **" + s.get("accuracy_30d") + " %**");
    out.add("");

    List<Map<String, Object>> vocab = (List<Map<String, Object>>) w.get("vocab");
    if (!vocab.isEmpty()) {
      out.add("## Hartnäckige Vokabeln");
      out.add("");
      for (Map<String, Object> v : vocab) {
        String line = "**" + v.get("term") + "** (" + v.get("de_primary") + ", " + v.get("topic") + ") — "
            + v.get("wrong") + "× falsch bei " + v.get("attempts") + " Versuchen";
        if (v.get("confused_with") != null) {
          line += ", zuletzt „" + v.get("last_typed") + "“ → verwechselt mit " + v.get("confused_with")
              + " (" + v.get("confused_with_de") + ")";
        } else if (v.get("last_typed") != null) {
          line += ", zuletzt „" + v.get("last_typed") + "“";
        }
        out.add("- " + line);
      }
      out.add("");
    }

    Map<String, Object> c = (Map<String, Object>) w.get("conjugation");
    List<Map<String, Object>> forms = (List<Map<String, Object>>) c.get("forms");
    List<Map<String, Object>> byTense = (List<Map<String, Object>>) c.get("byTense");
    List<Map<String, Object>> byPerson = (List<Map<String, Object>>) c.get("byPerson");
    if (!forms.isEmpty() || !byTense.isEmpty()) {
      out.add("## Konjugation");
      out.add("");
      forms.stream().limit(6).forEach(f -> {
        String typed = f.get("last_typed") == null ? ""
            : " (zuletzt „" + f.get("last_typed") + "“ statt „" + f.get("expected") + "“)";
        out.add("- " + f.get("verb") + ", " + or(f.get("tense_label"), f.get("tense")) + ", "
            + or(f.get("person_label"), f.get("person")) + " — " + f.get("wrong") + "× falsch" + typed);
      });
      if (!byTense.isEmpty()) {
        out.add("");
        out.add("Nach Zeit: " + byTense.stream()
            .map(t -> t.get("label") + " " + t.get("accuracy") + "% (" + t.get("attempts") + ")")
            .collect(Collectors.joining(" · ")));
      }
      if (!byPerson.isEmpty()) {
        out.add("Nach Person: " + byPerson.stream()
            .map(p -> p.get("label") + " " + p.get("accuracy") + "% (" + p.get("attempts") + ")")
            .collect(Collectors.joining(" · ")));
      }
      out.add("");
    }

    List<Map<String, Object>> grammar = (List<Map<String, Object>>) w.get("grammar");
    if (!grammar.isEmpty()) {
      out.add("## Grammatik");
      out.add("");
      grammar.forEach(g -> out.add("- " + g.get("label") + ": " + g.get("accuracy") + " % richtig bei "
          + g.get("attempts") + " " + (num(g.get("attempts")) == 1 ? "Aufgabe" : "Aufgaben")));
      out.add("");
    }

    List<Map<String, Object>> exercises = (List<Map<String, Object>>) w.get("exercises");
    if (!exercises.isEmpty()) {
      out.add("## Übungssätze");
      out.add("");
      exercises.forEach(p -> out.add("- " + p.get("title") + " (`" + p.get("id") + "`, " + p.get("status") + "): "
          + p.get("item_count") + " Aufgaben, "
          + (num(p.get("attempts")) > 0 ? p.get("attempts") + " Antworten, " + p.get("accuracy") + " % richtig"
              : "noch nicht geübt")));
      out.add("");
    }

    out.add("## Auftrag");
    out.add("");
    jobs(w).forEach(j -> out.add("- " + j));
    out.add("");
    out.add("Neue Übungen über `create_exercise` anlegen (Schema `" + PackValidator.SCHEMA + "`, Aufgabentypen: "
        + String.join(", ", PackValidator.ITEM_TYPES) + ").");
    return String.join("\n", out);
  }

  /** Concrete assignments - two focal points beat a list of shortcomings. */
  @SuppressWarnings("unchecked")
  static List<String> jobs(Map<String, Object> w) {
    List<String> out = new ArrayList<>();
    ((List<Map<String, Object>>) w.get("grammar")).stream()
        .filter(g -> g.get("accuracy") != null && num(g.get("accuracy")) < 80).limit(2)
        .forEach(g -> out.add("10 Lückensätze zu „" + g.get("label") + "“ (aktuell " + g.get("accuracy") + " %)"));

    Map<String, Object> c = (Map<String, Object>) w.get("conjugation");
    List<String> verbs = ((List<Map<String, Object>>) c.get("forms")).stream()
        .map(f -> (String) f.get("verb")).filter(Objects::nonNull)
        .collect(Collectors.toCollection(LinkedHashSet::new)).stream().limit(4).toList();
    if (!verbs.isEmpty()) {
      List<Map<String, Object>> byPerson = (List<Map<String, Object>>) c.get("byPerson");
      out.add("8 Sätze, die " + String.join(", ", verbs) + " "
          + (byPerson.isEmpty() ? "" : "in der Form „" + byPerson.getFirst().get("label") + "“ ") + "erzwingen");
    }

    List<String> confused = ((List<Map<String, Object>>) w.get("vocab")).stream()
        .filter(v -> v.get("confused_with") != null).limit(5)
        .map(v -> v.get("term") + " vs. " + v.get("confused_with")).toList();
    if (!confused.isEmpty()) out.add("Minimalpaare zu den verwechselten Vokabeln: " + String.join("; ", confused));

    if (out.isEmpty()) out.add("Keine auffälligen Schwächen — gemischte Wiederholung zu den zuletzt gelernten Themen.");
    return out;
  }

  private static int num(Object o) {
    return o instanceof Number n ? n.intValue() : 0;
  }

  private static Object or(Object a, Object b) {
    return a != null ? a : b;
  }
}
