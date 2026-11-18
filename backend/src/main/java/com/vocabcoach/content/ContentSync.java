package com.vocabcoach.content;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import java.util.Map;
import com.vocabcoach.learning.Course;
import tools.jackson.core.type.TypeReference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/**
 * Mirrors the learning content into the database at startup.
 *
 * <p>The source is web/src/courses/<course>/deck.js, conjugate.js and
 * grammar.js - the browser loads those directly. tools/export-content.js turns them into
 * content/content.json, which this class reads. In the database the coach can
 * connect weaknesses to content with plain SQL.
 */
@Component
@Order(1)
public class ContentSync implements ApplicationRunner {

  private static final Logger log = LoggerFactory.getLogger(ContentSync.class);

  record Vocab(String term, String de, String dePrimary, String pos, String level, String topic,
               String exampleTerm, String exampleDe) {}

  record Verb(String infinitive, String de, boolean irregular, String group) {}

  record GrammarItem(String id, String category, String prompt, List<String> options,
                     String answer, String explanation) {}

  record Label(String kind, String key, String label) {}

  record Content(List<Vocab> vocabulary, List<Verb> verbs, List<GrammarItem> grammarItems,
                 List<Label> labels) {}

  private final JdbcClient jdbc;
  private final JsonMapper json;

  public ContentSync(JdbcClient jdbc, JsonMapper json) {
    this.jdbc = jdbc;
    this.json = json;
  }

  @Override
  @Transactional
  public void run(ApplicationArguments args) throws IOException {
    Map<String, Content> courses;
    try (InputStream in = new ClassPathResource("content/content.json").getInputStream()) {
      courses = json.readValue(in, new TypeReference<Map<String, Content>>() {});
    }
    for (Course course : Course.values()) {
      Content c = courses.get(course.id);
      if (c == null) throw new IllegalStateException("content.json enthält keinen Kurs " + course.id);
      sync(course.id, c);
      log.info("Inhalte gespiegelt ({}): {} Vokabeln, {} Verben, {} Grammatikaufgaben",
          course.id, c.vocabulary().size(), c.verbs().size(), c.grammarItems().size());
    }
  }

  private void sync(String course, Content c) {
    for (Vocab v : c.vocabulary()) {
      jdbc.sql("""
          INSERT INTO vocabulary (course, term, de, de_primary, pos, level, topic, example_term, example_de)
          VALUES (?,?,?,?,?,?,?,?,?)
          ON CONFLICT (course, term) DO UPDATE SET de = EXCLUDED.de, de_primary = EXCLUDED.de_primary,
            pos = EXCLUDED.pos, level = EXCLUDED.level, topic = EXCLUDED.topic,
            example_term = EXCLUDED.example_term, example_de = EXCLUDED.example_de""")
          .params(course, v.term(), v.de(), v.dePrimary(), v.pos(), v.level(), v.topic(), v.exampleTerm(),
              v.exampleDe())
          .update();
    }
    for (Verb v : c.verbs()) {
      jdbc.sql("""
          INSERT INTO verbs (course, infinitive, de, irregular, verb_group) VALUES (?,?,?,?,?)
          ON CONFLICT (course, infinitive) DO UPDATE SET de = EXCLUDED.de,
            irregular = EXCLUDED.irregular, verb_group = EXCLUDED.verb_group""")
          .params(course, v.infinitive(), v.de(), v.irregular(), v.group())
          .update();
    }
    for (GrammarItem g : c.grammarItems()) {
      jdbc.sql("""
          INSERT INTO grammar_items (course, id, category, prompt, options, answer, explanation)
          VALUES (?,?,?,?,?,?,?)
          ON CONFLICT (course, id) DO UPDATE SET category = EXCLUDED.category, prompt = EXCLUDED.prompt,
            options = EXCLUDED.options, answer = EXCLUDED.answer, explanation = EXCLUDED.explanation""")
          .params(course, g.id(), g.category(), g.prompt(), g.options().toArray(String[]::new), g.answer(),
              g.explanation())
          .update();
    }
    for (Label l : c.labels()) {
      jdbc.sql("""
          INSERT INTO labels (course, kind, key, label) VALUES (?,?,?,?)
          ON CONFLICT (course, kind, key) DO UPDATE SET label = EXCLUDED.label""")
          .params(course, l.kind(), l.key(), l.label())
          .update();
    }
  }
}
