package com.vocabcoach.learning;

import com.vocabcoach.db.Rows;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * Every SQL access to a learner's state, in one place. Every method takes the
 * learner's id; there is no query without it.
 *
 * <p>The event table stays append-only: this class inserts into it and
 * reads from it, nothing else.
 */
@Repository
public class LearningStore {

  public static final Set<String> EVENT_KINDS = Set.of("vocab", "conj", "grammar", "pack", "sentence");
  public static final Set<String> EXERCISE_STATUSES = Set.of("ready", "draft", "archived");

  private final JdbcClient jdbc;
  private final Rows rows;

  public LearningStore(JdbcClient jdbc, Rows rows) {
    this.jdbc = jdbc;
    this.rows = rows;
  }

  // ---------- Settings (the app's own state blob) ----------

  public Object getSettings(long userId) {
    return jdbc.sql("SELECT data FROM settings WHERE user_id = ?").param(userId)
        .query((rs, i) -> rows.value(rs.getObject(1))).optional()
        .orElseGet(LinkedHashMap::new);
  }

  public void putSettings(long userId, JsonNode data) {
    jdbc.sql("""
        INSERT INTO settings (user_id, data) VALUES (?, ?)
        ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data""")
        .params(userId, rows.jsonb(data)).update();
  }

  // ---------- Cards (scheduler state per word) ----------

  public Map<String, Map<String, Object>> getCards(long userId) {
    Map<String, Map<String, Object>> out = new LinkedHashMap<>();
    jdbc.sql("""
        SELECT id, state, stability, difficulty, due, last_review, reps, lapses, step, interval_days
        FROM cards WHERE user_id = ?""").param(userId).query(rs -> {
          Map<String, Object> c = new LinkedHashMap<>();
          c.put("id", rs.getString("id"));
          c.put("state", rs.getString("state"));
          c.put("stability", rs.getDouble("stability"));
          c.put("difficulty", rs.getDouble("difficulty"));
          c.put("due", rs.getLong("due"));
          c.put("lastReview", rs.getLong("last_review"));
          c.put("reps", rs.getInt("reps"));
          c.put("lapses", rs.getInt("lapses"));
          c.put("step", rs.getInt("step"));
          c.put("interval", rs.getInt("interval_days"));
          out.put(rs.getString("id"), c);
        });
    return out;
  }

  /** Changed cards only; unknown words are skipped instead of failing. */
  @Transactional
  public int upsertCards(long userId, JsonNode cards) {
    int written = 0;
    for (JsonNode card : cards) {
      String id = card.path("id").asString("");
      if (id.isEmpty()) continue;
      written += jdbc.sql("""
          INSERT INTO cards (user_id, id, state, stability, difficulty, due, last_review, reps, lapses,
                             step, interval_days)
          SELECT ?,?,?,?,?,?,?,?,?,?,?
          WHERE EXISTS (SELECT 1 FROM vocabulary WHERE es = ?)
          ON CONFLICT (user_id, id) DO UPDATE SET
            state = EXCLUDED.state, stability = EXCLUDED.stability, difficulty = EXCLUDED.difficulty,
            due = EXCLUDED.due, last_review = EXCLUDED.last_review, reps = EXCLUDED.reps,
            lapses = EXCLUDED.lapses, step = EXCLUDED.step, interval_days = EXCLUDED.interval_days,
            updated_at = now()""")
          .params(userId, id, card.path("state").asString("new"),
              card.path("stability").asDouble(0), card.path("difficulty").asDouble(5),
              Math.round(card.path("due").asDouble(0)), Math.round(card.path("lastReview").asDouble(0)),
              card.path("reps").asInt(0), card.path("lapses").asInt(0), card.path("step").asInt(0),
              (int) Math.round(card.path("interval").asDouble(0)), id)
          .update();
    }
    return written;
  }

  // ---------- Events (append-only) ----------

  @Transactional
  public List<Long> appendEvents(long userId, JsonNode body) {
    List<JsonNode> list = new ArrayList<>();
    if (body != null && body.isArray()) body.forEach(list::add);
    else if (body != null && body.isObject()) list.add(body);

    List<Long> seqs = new ArrayList<>();
    for (JsonNode e : list) {
      String kind = e.path("kind").asString("");
      if (!EVENT_KINDS.contains(kind)) continue;
      ObjectNode payload = ((ObjectNode) e).deepCopy();
      payload.remove(List.of("kind", "ok", "t", "seq"));
      Timestamp t = e.hasNonNull("t") ? Timestamp.from(Instant.ofEpochMilli(e.get("t").asLong())) : null;
      seqs.add(jdbc.sql("""
          INSERT INTO events (user_id, t, kind, ok, payload)
          VALUES (?, COALESCE(?, now()), ?, ?, ?) RETURNING seq""")
          .params(userId, t, kind, e.path("ok").asBoolean(false), rows.jsonb(payload))
          .query(Long.class).single());
    }
    return seqs;
  }

  /** Events in the shape the app knows: t as epoch milliseconds, payload flattened. */
  public List<Map<String, Object>> getEvents(long userId, String kind, Long since, Integer limit) {
    StringBuilder sql = new StringBuilder("""
        SELECT seq, (EXTRACT(EPOCH FROM t) * 1000)::bigint AS t, kind, ok, payload
        FROM events WHERE user_id = :user""");
    Map<String, Object> params = new LinkedHashMap<>();
    params.put("user", userId);
    if (kind != null && !kind.isBlank()) { sql.append(" AND kind = :kind"); params.put("kind", kind); }
    if (since != null) { sql.append(" AND seq > :since"); params.put("since", since); }
    sql.append(" ORDER BY seq LIMIT :limit");
    params.put("limit", Math.min(limit == null || limit <= 0 ? 100_000 : limit, 200_000));

    return jdbc.sql(sql.toString()).params(params).query((rs, i) -> {
      Map<String, Object> e = new LinkedHashMap<>();
      e.put("seq", rs.getLong("seq"));
      e.put("t", rs.getLong("t"));
      e.put("kind", rs.getString("kind"));
      e.put("ok", rs.getBoolean("ok"));
      if (rows.value(rs.getObject("payload")) instanceof JsonNode payload && payload.isObject()) {
        for (var field : payload.properties()) e.putIfAbsent(field.getKey(), field.getValue());
      }
      return e;
    }).list();
  }

  // ---------- Exercise sets ----------

  public List<Map<String, Object>> getExercises(long userId, String status) {
    boolean all = "all".equals(status);
    return jdbc.sql("SELECT * FROM exercises WHERE user_id = :user"
            + (all ? "" : " AND status = :status") + " ORDER BY created_at DESC")
        .param("user", userId).param("status", all ? null : status)
        .query((rs, i) -> {
          Map<String, Object> x = new LinkedHashMap<>();
          Instant created = rs.getTimestamp("created_at").toInstant();
          x.put("id", rs.getString("id"));
          x.put("schema", rs.getString("schema_version"));
          x.put("title", rs.getString("title"));
          x.put("description", rs.getString("description"));
          x.put("createdBy", rs.getString("created_by"));
          x.put("createdAt", created.toString());
          x.put("addedAt", created.toEpochMilli());
          x.put("focus", rows.value(rs.getArray("focus")));
          x.put("status", rs.getString("status"));
          x.put("items", rows.value(rs.getObject("items")));
          x.put("source", "db:" + rs.getString("id"));
          return x;
        }).list();
  }

  public void upsertExercise(long userId, String id, String schema, String title, String description,
                             String createdBy, List<String> focus, String status, Object items) {
    jdbc.sql("""
        INSERT INTO exercises (user_id, id, schema_version, title, description, created_by, focus, status, items)
        VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT (user_id, id) DO UPDATE SET
          schema_version = EXCLUDED.schema_version, title = EXCLUDED.title,
          description = EXCLUDED.description, created_by = EXCLUDED.created_by,
          focus = EXCLUDED.focus, status = EXCLUDED.status, items = EXCLUDED.items""")
        .params(userId, id, schema, title, description, createdBy, focus.toArray(String[]::new), status,
            rows.jsonb(items))
        .update();
  }

  public boolean setExerciseStatus(long userId, String id, String status) {
    return jdbc.sql("UPDATE exercises SET status = ? WHERE user_id = ? AND id = ?")
        .params(status, userId, id).update() > 0;
  }

  public boolean deleteExercise(long userId, String id) {
    return jdbc.sql("DELETE FROM exercises WHERE user_id = ? AND id = ?").params(userId, id).update() > 0;
  }

  public Map<String, Map<String, Object>> exerciseResults(long userId) {
    Map<String, Map<String, Object>> out = new LinkedHashMap<>();
    view("SELECT * FROM v_exercise_results WHERE user_id = ?", userId)
        .forEach(r -> out.put((String) r.get("id"), r));
    return out;
  }

  // ---------- Vocabulary with the learner's state per word ----------

  public List<Map<String, Object>> searchVocabulary(long userId, String search, String topic, String level,
                                                    String pos, int limit) {
    StringBuilder sql = new StringBuilder("""
        SELECT v.es, v.de_primary, v.de, v.pos, v.level, v.topic, v.example_es, v.example_de,
               c.state, c.stability, c.lapses
        FROM vocabulary v LEFT JOIN cards c ON c.id = v.es AND c.user_id = :user WHERE true""");
    Map<String, Object> params = new LinkedHashMap<>();
    params.put("user", userId);
    if (notBlank(search)) { sql.append(" AND (v.es ILIKE :search OR v.de ILIKE :search)"); params.put("search", "%" + search + "%"); }
    if (notBlank(topic)) { sql.append(" AND v.topic = :topic"); params.put("topic", topic); }
    if (notBlank(level)) { sql.append(" AND v.level = :level"); params.put("level", level); }
    if (notBlank(pos)) { sql.append(" AND v.pos = :pos"); params.put("pos", pos); }
    sql.append(" ORDER BY v.es LIMIT :limit");
    params.put("limit", limit);
    return rows.normalize(jdbc.sql(sql.toString()).params(params).query().listOfRows());
  }

  // ---------- Analysis (the views are the only definition) ----------

  public Map<String, Object> weaknesses(long userId, int days, int limit) {
    Map<String, Object> w = new LinkedHashMap<>();
    w.put("generatedAt", Instant.now().toString());
    w.put("windowDays", days);
    w.put("summary", view("SELECT * FROM v_summary WHERE user_id = ?", userId).stream().findFirst()
        .orElseGet(LinkedHashMap::new));
    w.put("vocab", view("""
        SELECT * FROM v_vocab_mistakes
        WHERE user_id = ? AND last_wrong_at > now() - make_interval(days => ?)
        ORDER BY wrong DESC, attempts DESC LIMIT ?""", userId, days, limit));
    Map<String, Object> conj = new LinkedHashMap<>();
    conj.put("forms", view("""
        SELECT * FROM v_conjugation_mistakes
        WHERE user_id = ? AND last_at > now() - make_interval(days => ?)
        ORDER BY wrong DESC LIMIT ?""", userId, days, limit));
    conj.put("byTense", view("SELECT * FROM v_conjugation_by_tense WHERE user_id = ? ORDER BY accuracy", userId));
    conj.put("byPerson", view("SELECT * FROM v_conjugation_by_person WHERE user_id = ? ORDER BY accuracy", userId));
    w.put("conjugation", conj);
    w.put("grammar", view("SELECT * FROM v_grammar_accuracy WHERE user_id = ? ORDER BY accuracy", userId));
    w.put("sentences", view("SELECT * FROM v_sentence_mistakes WHERE user_id = ? LIMIT ?", userId, limit));
    w.put("exercises", view("SELECT * FROM v_exercise_results WHERE user_id = ? ORDER BY created_at DESC", userId));
    return w;
  }

  private List<Map<String, Object>> view(String sql, Object... params) {
    return rows.normalize(jdbc.sql(sql).params(params).query().listOfRows());
  }

  private static boolean notBlank(String s) {
    return s != null && !s.isBlank();
  }
}
