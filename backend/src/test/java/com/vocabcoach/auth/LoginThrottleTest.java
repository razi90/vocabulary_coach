package com.vocabcoach.auth;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.authentication.event.AuthenticationFailureBadCredentialsEvent;
import org.springframework.security.authentication.BadCredentialsException;

class LoginThrottleTest {

  private static AuthenticationFailureBadCredentialsEvent failure(String email) {
    return new AuthenticationFailureBadCredentialsEvent(
        new UsernamePasswordAuthenticationToken(email, "falsch"), new BadCredentialsException("falsch"));
  }

  @Test
  void locksAfterTheLimitAndNotBefore() {
    LoginThrottle t = new LoginThrottle();
    for (int i = 1; i < LoginThrottle.MAX_FAILURES; i++) t.onFailure(failure("a@example.com"));
    assertThat(t.isLocked("a@example.com")).isFalse();
    t.onFailure(failure("A@example.com "));      // same account, other spelling
    assertThat(t.isLocked("a@example.com")).isTrue();
    assertThat(t.isLocked("b@example.com")).isFalse();
  }

  @Test
  void aSuccessfulLoginClearsTheCount() {
    LoginThrottle t = new LoginThrottle();
    for (int i = 1; i < LoginThrottle.MAX_FAILURES; i++) t.onFailure(failure("a@example.com"));
    t.reset("a@example.com");
    t.onFailure(failure("a@example.com"));
    assertThat(t.isLocked("a@example.com")).isFalse();
  }
}
