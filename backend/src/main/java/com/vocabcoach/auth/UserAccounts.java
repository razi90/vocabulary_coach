package com.vocabcoach.auth;

import com.vocabcoach.UserError;
import com.vocabcoach.learning.Course;
import com.vocabcoach.learning.Learner;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.authentication.LockedException;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

/**
 * Accounts: email and password, nothing else.
 *
 * <p>The principal's name is the numeric user id, not the email. That keeps
 * every query on a stable key (an email can change) and keeps the session
 * free of any class of ours, which would break deserialization across
 * restarts.
 */
@Service
public class UserAccounts implements UserDetailsService {

  public static final int MIN_PASSWORD = 10;
  private static final Pattern EMAIL = Pattern.compile("^[^\\s@]+@[^\\s@]+$");

  public record Account(long id, String email, String displayName, boolean admin, String course) {}

  private final JdbcClient jdbc;
  private final PasswordEncoder encoder;
  private final LoginThrottle throttle;

  public UserAccounts(JdbcClient jdbc, PasswordEncoder encoder, LoginThrottle throttle) {
    this.jdbc = jdbc;
    this.encoder = encoder;
    this.throttle = throttle;
  }

  /** Called by the form login with the email the learner typed. */
  @Override
  public UserDetails loadUserByUsername(String email) {
    if (throttle.isLocked(email)) {
      throw new LockedException("Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.");
    }
    record Login(long id, String hash, boolean admin) {}
    Login login = jdbc.sql("""
        SELECT id, password_hash, is_admin FROM users
        WHERE lower(email) = lower(?) AND password_hash IS NOT NULL""")
        .param(email.trim())
        .query((rs, i) -> new Login(rs.getLong(1), rs.getString(2), rs.getBoolean(3)))
        .optional().orElseThrow(() -> new UsernameNotFoundException("unbekannt"));
    return User.withUsername(Long.toString(login.id())).password(login.hash())
        .roles(login.admin() ? new String[] {"USER", "ADMIN"} : new String[] {"USER"}).build();
  }

  public Optional<Account> find(long id) {
    return jdbc.sql("SELECT id, email, display_name, is_admin, course FROM users WHERE id = ?").param(id)
        .query((rs, i) -> new Account(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getBoolean(4), rs.getString(5)))
        .optional();
  }

  public List<Account> list() {
    return jdbc.sql("SELECT id, email, display_name, is_admin, course FROM users ORDER BY id")
        .query((rs, i) -> new Account(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getBoolean(4), rs.getString(5)))
        .list();
  }

  public long register(String email, String password, String displayName, Course course) {
    String clean = validEmail(email);
    validPassword(password);
    try {
      return jdbc.sql("""
          INSERT INTO users (email, password_hash, display_name, course) VALUES (?, ?, ?, ?) RETURNING id""")
          .params(clean, encoder.encode(password), displayName == null ? "" : displayName.trim(), course.id)
          .query(Long.class).single();
    } catch (DuplicateKeyException e) {
      throw new UserError("Für diese E-Mail-Adresse gibt es schon ein Konto.");
    }
  }

  /** Which course the learner is in. Their progress in the other course stays as it is. */
  public void setCourse(long id, Course course) {
    jdbc.sql("UPDATE users SET course = ? WHERE id = ?").params(course.id, id).update();
  }

  /** The logged-in user in their current course. */
  public Learner currentLearner() {
    long id = CurrentUser.id();
    String course = jdbc.sql("SELECT course FROM users WHERE id = ?").param(id).query(String.class).single();
    return new Learner(id, Course.byId(course).orElse(Course.ES));
  }

  public void changePassword(long id, String current, String next) {
    String hash = jdbc.sql("SELECT password_hash FROM users WHERE id = ?").param(id).query(String.class).single();
    if (hash == null || !encoder.matches(current == null ? "" : current, hash)) {
      throw new UserError("Das bisherige Passwort stimmt nicht.");
    }
    setPassword(id, next);
  }

  public void setPassword(long id, String password) {
    validPassword(password);
    jdbc.sql("UPDATE users SET password_hash = ? WHERE id = ?").params(encoder.encode(password), id).update();
  }

  /**
   * The first account holds the data from before multi-user and starts
   * without a password. ADMIN_EMAIL / ADMIN_PASSWORD give it one - once.
   * Afterwards the learner changes it in the app like everyone else.
   */
  public boolean claimFirstAccount(String email, String password) {
    String clean = validEmail(email);
    validPassword(password);
    try {
      return jdbc.sql("UPDATE users SET email = ?, password_hash = ? WHERE id = 1 AND password_hash IS NULL")
          .params(clean, encoder.encode(password)).update() > 0;
    } catch (DuplicateKeyException e) {
      throw new UserError("ADMIN_EMAIL gehört schon einem anderen Konto.");
    }
  }

  private static String validEmail(String email) {
    String clean = email == null ? "" : email.trim();
    if (clean.length() > 254 || !EMAIL.matcher(clean).matches()) {
      throw new UserError("Bitte eine gültige E-Mail-Adresse angeben.");
    }
    return clean;
  }

  private static void validPassword(String password) {
    if (password == null || password.length() < MIN_PASSWORD) {
      throw new UserError("Das Passwort braucht mindestens " + MIN_PASSWORD + " Zeichen.");
    }
    if (password.length() > 200) throw new UserError("Das Passwort ist zu lang.");
  }
}
