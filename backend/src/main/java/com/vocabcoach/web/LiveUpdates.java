package com.vocabcoach.web;

import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.sql.Connection;
import java.sql.Statement;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import javax.sql.DataSource;
import org.postgresql.PGConnection;
import org.postgresql.PGNotification;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Forwards database changes to the learner's open tabs.
 *
 * <p>Triggers on exercises, lessons and coach_runs send pg_notify with the
 * owner's id. One connection LISTENs for them and pushes a server-sent event
 * to that learner's streams only. Whoever writes - the app, the coach, psql -
 * the tab updates without a reload.
 */
@Component
public class LiveUpdates {

  private static final Logger log = LoggerFactory.getLogger(LiveUpdates.class);
  private static final Map<String, String> CHANNELS = Map.of(
      "exercises_changed", "exercises",
      "lessons_changed", "lessons",
      "coach_runs_changed", "runs");

  private final DataSource dataSource;
  private final JsonMapper json;
  private final Map<Long, Set<SseEmitter>> streams = new ConcurrentHashMap<>();
  private volatile boolean running = true;
  private Thread listener;

  public LiveUpdates(DataSource dataSource, JsonMapper json) {
    this.dataSource = dataSource;
    this.json = json;
  }

  public SseEmitter open(long userId) {
    SseEmitter emitter = new SseEmitter(0L);
    Set<SseEmitter> mine = streams.computeIfAbsent(userId, k -> ConcurrentHashMap.newKeySet());
    mine.add(emitter);
    Runnable remove = () -> mine.remove(emitter);
    emitter.onCompletion(remove);
    emitter.onTimeout(remove);
    emitter.onError(e -> remove.run());
    try {
      emitter.send(SseEmitter.event().reconnectTime(3000).comment("verbunden"));
    } catch (IOException e) {
      remove.run();
    }
    return emitter;
  }

  void publish(long userId, String event, String id) {
    Set<SseEmitter> mine = streams.get(userId);
    if (mine == null) return;
    for (SseEmitter emitter : mine) {
      try {
        emitter.send(SseEmitter.event().name(event).data(Map.of("id", id)));
      } catch (IOException | IllegalStateException e) {
        mine.remove(emitter);
      }
    }
  }

  /** An event for every open tab, whoever is logged in (development reload). */
  void publishAll(String event) {
    streams.values().forEach(set -> set.removeIf(emitter -> {
      try {
        emitter.send(SseEmitter.event().name(event).data("{}"));
        return false;
      } catch (IOException | IllegalStateException e) {
        return true;
      }
    }));
  }

  /** Proxies drop idle connections; a comment every 25 s keeps them open. */
  @Scheduled(fixedRate = 25_000)
  void ping() {
    streams.values().forEach(set -> set.removeIf(emitter -> {
      try {
        emitter.send(SseEmitter.event().comment("ping"));
        return false;
      } catch (IOException | IllegalStateException e) {
        return true;
      }
    }));
  }

  @EventListener(ApplicationReadyEvent.class)
  void start() {
    listener = Thread.ofVirtual().name("pg-listen").start(this::listenLoop);
  }

  private void listenLoop() {
    while (running) {
      try (Connection conn = dataSource.getConnection()) {
        try (Statement st = conn.createStatement()) {
          for (String channel : CHANNELS.keySet()) st.execute("LISTEN " + channel);
        }
        log.info("Lausche auf {}", CHANNELS.keySet());
        PGConnection pg = conn.unwrap(PGConnection.class);
        while (running) {
          PGNotification[] notes = pg.getNotifications(10_000);
          if (notes == null) continue;
          for (PGNotification n : notes) dispatch(n);
        }
      } catch (Exception e) {
        if (!running) return;
        log.warn("LISTEN-Verbindung verloren, neuer Versuch in 5 s: {}", e.getMessage());
        try {
          Thread.sleep(5000);
        } catch (InterruptedException ie) {
          return;
        }
      }
    }
  }

  private void dispatch(PGNotification n) {
    String event = CHANNELS.get(n.getName());
    if (event == null) return;
    try {
      JsonNode payload = json.readTree(n.getParameter());
      publish(payload.path("user").asLong(), event, payload.path("id").asString(""));
    } catch (RuntimeException e) {
      log.warn("Unlesbare Benachrichtigung auf {}: {}", n.getName(), n.getParameter());
    }
  }

  @PreDestroy
  void stop() {
    running = false;
    if (listener != null) listener.interrupt();
    streams.values().forEach(set -> set.forEach(SseEmitter::complete));
  }
}
