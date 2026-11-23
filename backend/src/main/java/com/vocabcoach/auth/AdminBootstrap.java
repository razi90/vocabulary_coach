package com.vocabcoach.auth;

import com.vocabcoach.config.AppProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/** Gives the first account (the one owning pre-existing data) its credentials. */
@Component
@Order(2)
public class AdminBootstrap implements ApplicationRunner {

  private static final Logger log = LoggerFactory.getLogger(AdminBootstrap.class);

  private final UserAccounts accounts;
  private final AppProperties props;

  public AdminBootstrap(UserAccounts accounts, AppProperties props) {
    this.accounts = accounts;
    this.props = props;
  }

  @Override
  public void run(ApplicationArguments args) {
    boolean configured = notBlank(props.adminEmail()) && notBlank(props.adminPassword());
    boolean claimed = accounts.find(1).map(a -> !"admin@localhost".equals(a.email())).orElse(true);
    if (configured && accounts.claimFirstAccount(props.adminEmail(), props.adminPassword())) {
      log.info("Erstes Konto eingerichtet: {}", props.adminEmail());
    } else if (!configured && !claimed) {
      log.warn("Noch kein Konto mit Passwort. ADMIN_EMAIL und ADMIN_PASSWORD setzen und neu starten.");
    }
  }

  private static boolean notBlank(String s) {
    return s != null && !s.isBlank();
  }
}
