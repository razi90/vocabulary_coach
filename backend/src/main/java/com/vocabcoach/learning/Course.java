package com.vocabcoach.learning;

import java.util.Arrays;
import java.util.Optional;

/**
 * The languages a learner can study, always from German. Everything the
 * server says about "the language" - in the coach's instructions, in tool
 * descriptions, in default task texts, for YouTube - comes from here.
 */
public enum Course {

  ES("es", "Spanisch", "spanischsprachige", "ins Spanische", "auf Spanisch",
      "pedir comida en un restaurante español"),
  EN("en", "Englisch", "englischsprachige", "ins Englische", "auf Englisch",
      "ordering food in a restaurant English listening");

  /** Also the language code: lang attributes, YouTube, subtitles. */
  public final String id;
  public final String nameDe;
  /** "spanischsprachige Videos" */
  public final String adjectiveDe;
  /** "Übersetze die Sätze ins Spanische." */
  public final String intoDe;
  /** "Schreib auf Spanisch, was du verstanden hast." */
  public final String inDe;
  /** An example search for the video tool's description. */
  public final String exampleSearch;

  Course(String id, String nameDe, String adjectiveDe, String intoDe, String inDe, String exampleSearch) {
    this.id = id;
    this.nameDe = nameDe;
    this.adjectiveDe = adjectiveDe;
    this.intoDe = intoDe;
    this.inDe = inDe;
    this.exampleSearch = exampleSearch;
  }

  public static Optional<Course> byId(String id) {
    return Arrays.stream(values()).filter(c -> c.id.equals(id)).findFirst();
  }

  /** Fills {{sprache}}, {{sprachig}}, {{insSprache}}, {{aufSprache}}, {{beispielsuche}}, {{code}}. */
  public String fill(String template) {
    return template
        .replace("{{sprache}}", nameDe)
        .replace("{{sprachig}}", adjectiveDe)
        .replace("{{insSprache}}", intoDe)
        .replace("{{aufSprache}}", inDe)
        .replace("{{beispielsuche}}", exampleSearch)
        .replace("{{code}}", id);
  }
}
