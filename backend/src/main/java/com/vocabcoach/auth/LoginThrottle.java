package com.vocabcoach.auth;

import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.authentication.event.AuthenticationFailureBadCredentialsEvent;
import org.springframework.stereotype.Component;

/**
 * Slows down password guessing: after ten wrong passwords for an email, that
 * email is locked for fifteen minutes. In memory - for a handful of learners
 * on one server that is enough, and a restart forgetting it is harmless.
 */
@Component
public class LoginThrottle {

  static final int MAX_FAILURES = 10;
  static final Duration LOCK = Duration.ofMinutes(15);
  public static final String LOCKED_MESSAGE = "Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.";

  /**
   * Failures counted since {@code since}; once the count reaches the limit,
   * {@code lockedUntil} is set - the lock runs from that moment, not from
   * the first failure.
   */
  private record Failures(int count, Instant since, Instant lockedUntil) {
    boolean locked(Instant now) {
      return lockedUntil != null && lockedUntil.isAfter(now);
    }

    /** Nothing left to remember: the lock is over, or the counting window passed without one. */
    boolean stale(Instant now) {
      return lockedUntil != null ? !lockedUntil.isAfter(now) : !since.plus(LOCK).isAfter(now);
    }
  }

  private final Map<String, Failures> failures = new ConcurrentHashMap<>();

  public boolean isLocked(String email) {
    Failures f = failures.get(key(email));
    return f != null && f.locked(Instant.now());
  }

  @EventListener
  public void onFailure(AuthenticationFailureBadCredentialsEvent event) {
    Instant now = Instant.now();
    failures.compute(key(event.getAuthentication().getName()), (k, old) -> {
      if (old == null || old.stale(now)) return new Failures(1, now, null);
      if (old.locked(now)) return old;
      int count = old.count() + 1;
      return new Failures(count, old.since(), count >= MAX_FAILURES ? now.plus(LOCK) : null);
    });
  }

  public void reset(String email) {
    failures.remove(key(email));
  }

  @Scheduled(fixedRate = 600_000)
  void forgetOld() {
    Instant now = Instant.now();
    failures.values().removeIf(f -> f.stale(now));
  }

  private static String key(String email) {
    return email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
  }
}
