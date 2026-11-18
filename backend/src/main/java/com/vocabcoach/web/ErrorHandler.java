package com.vocabcoach.web;

import com.vocabcoach.UserError;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

/** Errors as {@code {"error": "..."}} - the shape the frontend reads. */
@RestControllerAdvice
public class ErrorHandler {

  private static final Logger log = LoggerFactory.getLogger(ErrorHandler.class);

  @ExceptionHandler(UserError.class)
  ResponseEntity<Map<String, Object>> userError(UserError e) {
    return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
  }

  @ExceptionHandler(HttpMessageNotReadableException.class)
  ResponseEntity<Map<String, Object>> unreadable(HttpMessageNotReadableException e) {
    return ResponseEntity.badRequest().body(Map.of("error", "ungültiges JSON"));
  }

  @ExceptionHandler(ResponseStatusException.class)
  ResponseEntity<Map<String, Object>> status(ResponseStatusException e) {
    String reason = e.getReason() != null ? e.getReason() : HttpStatus.valueOf(e.getStatusCode().value()).getReasonPhrase();
    return ResponseEntity.status(e.getStatusCode()).body(Map.of("error", reason));
  }

  @ExceptionHandler(org.springframework.security.core.AuthenticationException.class)
  ResponseEntity<Map<String, Object>> unauthenticated(Exception e) {
    return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "nicht angemeldet"));
  }

  @ExceptionHandler(org.springframework.web.servlet.resource.NoResourceFoundException.class)
  ResponseEntity<Map<String, Object>> notFound(Exception e) {
    return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "nicht gefunden"));
  }

  @ExceptionHandler(Exception.class)
  ResponseEntity<Map<String, Object>> unexpected(Exception e) {
    log.error("Unerwarteter Fehler", e);
    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", "Interner Fehler"));
  }
}
