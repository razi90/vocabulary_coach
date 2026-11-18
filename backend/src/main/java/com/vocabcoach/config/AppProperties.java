package com.vocabcoach.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/** Settings under {@code app.*} in application.yml. */
@ConfigurationProperties("app")
public record AppProperties(
    String encryptionKey,
    String registrationCode,
    String adminEmail,
    String adminPassword,
    Coach coach) {

  public record Coach(
      @DefaultValue("25") int maxSteps,
      @DefaultValue("180s") Duration requestTimeout) {}

  public boolean registrationOpen() {
    return registrationCode != null && !registrationCode.isBlank();
  }
}
