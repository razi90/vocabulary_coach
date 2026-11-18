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

  private record Failures(int count, Instant since) {}

  private final Map<String, Failures> failures = new ConcurrentHashMap<>();

  public boolean isLocked(String email) {
    Failures f = failures.get(key(email));
    return f != null && f.count() >= MAX_FAILURES && f.since().plus(LOCK).isAfter(Instant.now());
  }

  @EventListener
  public void onFailure(AuthenticationFailureBadCredentialsEvent event) {
    failures.merge(key(event.getAuthentication().getName()), new Failures(1, Instant.now()),
        (old, one) -> old.since().plus(LOCK).isBefore(Instant.now()) ? one : new Failures(old.count() + 1, old.since()));
  }

  public void reset(String email) {
    failures.remove(key(email));
  }

  @Scheduled(fixedRate = 600_000)
  void forgetOld() {
    Instant cutoff = Instant.now().minus(LOCK);
    failures.values().removeIf(f -> f.since().isBefore(cutoff));
  }

  private static String key(String email) {
    return email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
  }
}
