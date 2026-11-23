package com.vocabcoach.learning;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** The same rules as parse() in web/src/packs.js. */
class PackValidatorTest {

  private final JsonMapper json = JsonMapper.builder().build();
  private final PackValidator validator = new PackValidator();

  private JsonNode pack(String items) {
    return json.readTree("""
        {"schema":"vocab-coach/exercise-pack@1","id":"por-para","title":"Por vs. para","items":%s}""".formatted(items));
  }

  @Test
  void acceptsValidItemsOfEveryType() {
    var r = validator.parse(pack("""
        [{"type":"choice","prompt":"Gracias ___ tu ayuda","options":["por","para"],"answer":"por"},
         {"type":"cloze","prompt":"Estudio ___ aprender.","answer":"para"},
         {"type":"translate","prompt":"Danke für deine Hilfe","answer":"Gracias por tu ayuda"}]"""), "test");
    assertThat(r.ok()).isTrue();
    assertThat(r.errors()).isEmpty();
    assertThat(r.pack().items()).hasSize(3);
    assertThat(r.pack().items().get(2)).containsEntry("from", "de").containsEntry("to", "es");
  }

  @Test
  void dropsBrokenItemsAndNamesTheReason() {
    var r = validator.parse(pack("""
        [{"type":"choice","prompt":"x","options":["a","b"],"answer":"c"},
         {"type":"cloze","prompt":"ohne Lücke","answer":"a"},
         {"type":"quiz","prompt":"x"},
         {"type":"translate","prompt":"Haus","answer":"casa"}]"""), "test");
    assertThat(r.ok()).isTrue();
    assertThat(r.pack().items()).hasSize(1);
    assertThat(r.errors()).containsExactly(
        "test: Aufgabe 1 (choice) – answer \"c\" ist keine der options",
        "test: Aufgabe 2 (cloze) – prompt braucht eine Lücke (___)",
        "test: Aufgabe 3 hat unbekannten type \"quiz\"");
  }

  @Test
  void rejectsWrongSchemaAndEmptySets() {
    assertThat(validator.parse(json.readTree("{\"schema\":\"x\",\"id\":\"a\",\"items\":[]}"), "t").errors())
        .containsExactly("t: schema muss \"vocab-coach/exercise-pack@1\" sein (war: x)");
    assertThat(validator.parse(pack("[]"), "t").errors()).containsExactly("t: items fehlt oder ist leer");
    assertThat(validator.parse(pack("[{\"type\":\"cloze\",\"prompt\":\"\"}]"), "t").ok()).isFalse();
  }

  @Test
  void choiceIsTheDefaultTypeAndOptionsAreLimited() {
    var r = validator.parse(pack("""
        [{"prompt":"x","options":["1","2","3","4","5","6","7"],"answer":"1"}]"""), "t");
    assertThat(r.ok()).isFalse();
    assertThat(r.errors()).containsExactly("t: Aufgabe 1 (choice) – höchstens sechs options");
  }
}
