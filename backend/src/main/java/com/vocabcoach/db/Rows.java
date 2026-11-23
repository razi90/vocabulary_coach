package com.vocabcoach.db;

import java.sql.Array;
import java.sql.Date;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.postgresql.util.PGobject;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Turns JDBC rows into values that serialize to the JSON the frontend and the
 * coach expect: jsonb becomes a JSON tree, arrays become lists, timestamps
 * become ISO instants, dates become "YYYY-MM-DD".
 *
 * <p>The views are queried as generic rows on purpose. Their columns are the
 * interface; mapping each one into a record would only add a second place to
 * keep in sync.
 */
@Component
public class Rows {

  private final JsonMapper json;

  public Rows(JsonMapper json) {
    this.json = json;
  }

  public Map<String, Object> normalize(Map<String, Object> row) {
    Map<String, Object> out = new LinkedHashMap<>();
    row.forEach((k, v) -> out.put(k, value(v)));
    return out;
  }

  public List<Map<String, Object>> normalize(List<Map<String, Object>> rows) {
    return rows.stream().map(this::normalize).toList();
  }

  public Object value(Object v) {
    try {
      return switch (v) {
        case null -> null;
        case PGobject pg when "jsonb".equals(pg.getType()) || "json".equals(pg.getType()) ->
            pg.getValue() == null ? null : json.readTree(pg.getValue());
        case PGobject pg -> pg.getValue();
        case Array a -> {
          Object[] items = (Object[]) a.getArray();
          List<Object> list = new ArrayList<>(items.length);
          Arrays.stream(items).map(this::value).forEach(list::add);
          yield list;
        }
        case Timestamp ts -> ts.toInstant();
        case Date d -> d.toLocalDate();
        default -> v;
      };
    } catch (SQLException e) {
      throw new IllegalStateException("Spalte nicht lesbar: " + e.getMessage(), e);
    }
  }

  /** A JSON value as a jsonb parameter. */
  public PGobject jsonb(Object value) {
    try {
      PGobject pg = new PGobject();
      pg.setType("jsonb");
      pg.setValue(value == null ? null
          : value instanceof JsonNode node ? json.writeValueAsString(node) : json.writeValueAsString(value));
      return pg;
    } catch (SQLException e) {
      throw new IllegalStateException(e);
    }
  }
}
