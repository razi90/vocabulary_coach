package com.vocabcoach.coach;

import static org.assertj.core.api.Assertions.assertThat;

import com.vocabcoach.learning.Course;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

/** Every course gets complete instructions and tool texts - no placeholder left, no other language. */
class CoachPromptTest {

  private static String resource(String path) throws IOException {
    try (InputStream in = new ClassPathResource(path).getInputStream()) {
      return new String(in.readAllBytes(), StandardCharsets.UTF_8);
    }
  }

  private static String prompt(Course course) throws IOException {
    return CoachRunner.systemPrompt(resource("coach/system-prompt.md"),
        resource("coach/course-" + course.id + ".md"), course);
  }

  @Test
  void spanishPromptIsAboutSpanish() throws IOException {
    String p = prompt(Course.ES);
    assertThat(p).startsWith("# Spanisch coach").contains("Spanish coach").contains("ser_estar")
        .contains("presente").doesNotContain("{{").doesNotContain("English").doesNotContain("<!--");
  }

  @Test
  void englishPromptIsAboutEnglish() throws IOException {
    String p = prompt(Course.EN);
    assertThat(p).startsWith("# Englisch coach").contains("English coach").contains("false_friends")
        .contains("present_perfect").contains("since-for-zeitpunkt-vs-dauer")
        .doesNotContain("{{").doesNotContain("Spanish").doesNotContain("ser_estar").doesNotContain("<!--");
  }

  @Test
  void toolTextsAreFilledForEveryCourse() throws IOException {
    String tools = resource("coach/tools.json");
    assertThat(tools).contains("{{sprache}}");
    assertThat(Course.EN.fill(tools)).doesNotContain("{{").contains("englischsprachige").contains("ins Englische")
        .doesNotContain("Spanisch").doesNotContain("spanisch");
    assertThat(Course.ES.fill(tools)).doesNotContain("{{").contains("spanischsprachige");
  }
}
