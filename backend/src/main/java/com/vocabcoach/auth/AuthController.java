package com.vocabcoach.auth;

import com.vocabcoach.UserError;
import com.vocabcoach.config.AppProperties;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** Registration, the current account, password change. Login/logout live in SecurityConfig. */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

  public record Registration(String email, String password, String displayName, String code) {}

  public record PasswordChange(String current, String next) {}

  private final UserAccounts accounts;
  private final AppProperties props;
  private final SecurityContextRepository contexts;

  public AuthController(UserAccounts accounts, AppProperties props, SecurityContextRepository contexts) {
    this.accounts = accounts;
    this.props = props;
    this.contexts = contexts;
  }

  /** What the login page needs to know before anyone is logged in. */
  @GetMapping("/config")
  public Map<String, Object> config() {
    return Map.of("registrationOpen", props.registrationOpen(), "minPassword", UserAccounts.MIN_PASSWORD);
  }

  @PostMapping("/register")
  @ResponseStatus(HttpStatus.CREATED)
  public Map<String, Object> register(@RequestBody Registration r, HttpServletRequest req, HttpServletResponse res) {
    if (!props.registrationOpen()) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Die Registrierung ist geschlossen.");
    }
    if (!constantTimeEquals(props.registrationCode(), r.code())) {
      throw new UserError("Der Einladungscode stimmt nicht.");
    }
    long id = accounts.register(r.email(), r.password(), r.displayName());

    // Log the new learner in right away.
    UserDetails user = accounts.loadUserByUsername(r.email());
    SecurityContext context = SecurityContextHolder.createEmptyContext();
    context.setAuthentication(UsernamePasswordAuthenticationToken.authenticated(user, null, user.getAuthorities()));
    SecurityContextHolder.setContext(context);
    if (req.getSession(false) != null) req.changeSessionId();
    contexts.saveContext(context, req, res);
    return Map.of("ok", true, "id", id);
  }

  @GetMapping("/me")
  public UserAccounts.Account me() {
    return accounts.find(CurrentUser.id())
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED));
  }

  @PostMapping("/password")
  public Map<String, Object> changePassword(@RequestBody PasswordChange p) {
    accounts.changePassword(CurrentUser.id(), p.current(), p.next());
    return Map.of("ok", true);
  }

  private static boolean constantTimeEquals(String expected, String given) {
    return MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),
        (given == null ? "" : given.trim()).getBytes(StandardCharsets.UTF_8));
  }
}
