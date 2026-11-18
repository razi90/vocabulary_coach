package com.vocabcoach.auth;

import jakarta.servlet.http.HttpServletResponse;
import java.nio.charset.StandardCharsets;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.LockedException;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.HttpStatusEntryPoint;
import org.springframework.security.web.authentication.LoginUrlAuthenticationEntryPoint;
import org.springframework.security.web.authentication.logout.HttpStatusReturningLogoutSuccessHandler;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.security.web.util.matcher.AnyRequestMatcher;

/**
 * Login with email and password, kept in a server-side session (stored in
 * Postgres by Spring Session, so it survives restarts).
 *
 * <p>The frontend is a single page that talks to /api with fetch, so:
 * login and logout answer with a status code instead of a redirect, /api
 * answers 401 instead of redirecting to the login page, and CSRF uses the
 * SPA setup - the token sits in the XSRF-TOKEN cookie and every write sends
 * it back as the X-XSRF-TOKEN header.
 */
@Configuration
public class SecurityConfig {

  @Bean
  PasswordEncoder passwordEncoder() {
    return PasswordEncoderFactories.createDelegatingPasswordEncoder();
  }

  @Bean
  SecurityContextRepository securityContextRepository() {
    return new HttpSessionSecurityContextRepository();
  }

  @Bean
  SecurityFilterChain security(HttpSecurity http, LoginThrottle throttle, SecurityContextRepository contexts)
      throws Exception {
    http
        .authorizeHttpRequests(a -> a
            .requestMatchers("/login.html", "/src/auth.js", "/src/style.css",
                "/manifest.webmanifest", "/sw.js", "/api/auth/register", "/api/auth/config",
                "/actuator/health/**", "/error")
            .permitAll()
            .anyRequest().authenticated())
        .securityContext(c -> c.securityContextRepository(contexts))
        .formLogin(f -> f
            .loginPage("/login.html")
            .loginProcessingUrl("/login")
            .usernameParameter("email")
            .successHandler((req, res, auth) -> {
              throttle.reset(req.getParameter("email"));
              json(res, HttpStatus.OK, "{\"ok\":true}");
            })
            .failureHandler((req, res, e) -> json(res, HttpStatus.UNAUTHORIZED,
                "{\"error\":\"" + (e instanceof LockedException ? e.getMessage()
                    : "E-Mail oder Passwort stimmt nicht.") + "\"}"))
            .permitAll())
        .logout(l -> l
            .logoutUrl("/logout")
            .logoutSuccessHandler(new HttpStatusReturningLogoutSuccessHandler(HttpStatus.OK)))
        .csrf(c -> c.spa())
        .requestCache(r -> r.disable())
        // /api answers 401; pages go to the login page. (With a single
        // mapping Spring would use it for every request, hence both.)
        .exceptionHandling(e -> e
            .defaultAuthenticationEntryPointFor(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED),
                PathPatternRequestMatcher.pathPattern("/api/**"))
            .defaultAuthenticationEntryPointFor(new LoginUrlAuthenticationEntryPoint("/login.html"),
                AnyRequestMatcher.INSTANCE));
    return http.build();
  }

  private static void json(HttpServletResponse res, HttpStatus status, String body) throws java.io.IOException {
    res.setStatus(status.value());
    res.setContentType("application/json");
    res.setCharacterEncoding(StandardCharsets.UTF_8.name());
    res.getWriter().write(body);
  }
}
