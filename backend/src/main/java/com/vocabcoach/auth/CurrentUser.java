package com.vocabcoach.auth;

import org.springframework.security.authentication.AuthenticationCredentialsNotFoundException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

/** The logged-in learner's id. Every data access starts here. */
public final class CurrentUser {

  private CurrentUser() {}

  public static long id() {
    Authentication auth = SecurityContextHolder.getContext().getAuthentication();
    if (auth == null || !auth.isAuthenticated()) {
      throw new AuthenticationCredentialsNotFoundException("nicht angemeldet");
    }
    try {
      return Long.parseLong(auth.getName());
    } catch (NumberFormatException e) {
      throw new AuthenticationCredentialsNotFoundException("nicht angemeldet");
    }
  }
}
