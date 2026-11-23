package com.vocabcoach.web;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import java.util.stream.Stream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Development only: reloads every open tab when a frontend file changes.
 *
 * <p>The frontend is mounted into the container, so an edit is served on the
 * next request anyway; this saves pressing reload. Off unless
 * {@code DEV_RELOAD=true}, so production never sends the event.
 *
 * <p>It polls instead of using a file system watcher: whether a bind mount
 * passes the editor's change events into the container depends on Docker
 * Desktop and the platform. Comparing the newest modification time and the
 * file count of a few dozen files every 700 ms works everywhere.
 */
@Component
@ConditionalOnProperty(name = "app.dev-reload", havingValue = "true")
public class DevReload {

  private static final Logger log = LoggerFactory.getLogger(DevReload.class);
  private static final Set<String> WATCHED = Set.of(".html", ".js", ".css", ".webmanifest");

  private final LiveUpdates live;
  private final Path root;
  private Signature last;

  public DevReload(LiveUpdates live, @Value("${spring.web.resources.static-locations}") String location) {
    this.live = live;
    this.root = Path.of(location.replaceFirst("^file:", "")).toAbsolutePath().normalize();
    this.last = signature(root);
    log.info("Live-Reload aktiv für {}", root);
  }

  @Scheduled(fixedDelay = 700)
  void poll() {
    Signature now = signature(root);
    if (now == null || now.equals(last)) return;
    last = now;
    log.info("Frontend geändert, Tabs laden neu");
    live.publishAll("reload");
  }

  /** What changes when a frontend file is saved, added or removed; null if the walk failed. */
  record Signature(long newest, int files) {}

  static Signature signature(Path root) {
    if (!Files.isDirectory(root)) return new Signature(0, 0);
    try (Stream<Path> paths = Files.walk(root)) {
      long newest = 0;
      int files = 0;
      for (Path p : (Iterable<Path>) paths::iterator) {
        String name = p.getFileName().toString();
        int dot = name.lastIndexOf('.');
        if (dot < 0 || !WATCHED.contains(name.substring(dot)) || !Files.isRegularFile(p)) continue;
        files++;
        newest = Math.max(newest, Files.getLastModifiedTime(p).toMillis());
      }
      return new Signature(newest, files);
    } catch (IOException | UncheckedIOException e) {
      // An editor may delete and rename while we walk; the next poll sees the result.
      return null;
    }
  }
}
