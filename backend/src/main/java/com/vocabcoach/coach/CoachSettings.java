package com.vocabcoach.coach;

import com.vocabcoach.UserError;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Which provider and model a learner's coach uses, plus the encrypted key. */
@Repository
public class CoachSettings {

  public record Settings(Provider provider, String model, String keyHint, boolean hasKey) {}

  /** Everything needed to call the model. The key exists only in memory. */
  public record Credentials(Provider provider, String model, String apiKey) {}

  private final JdbcClient jdbc;
  private final KeyCipher cipher;

  public CoachSettings(JdbcClient jdbc, KeyCipher cipher) {
    this.jdbc = jdbc;
    this.cipher = cipher;
  }

  public Optional<Settings> find(long userId) {
    return jdbc.sql("SELECT provider, model, api_key_hint, api_key_enc IS NOT NULL FROM coach_settings WHERE user_id = ?")
        .param(userId)
        .query((rs, i) -> new Settings(Provider.byId(rs.getString(1)).orElse(Provider.OPENROUTER),
            rs.getString(2), rs.getString(3), rs.getBoolean(4)))
        .optional();
  }

  /**
   * Saves provider and model; replaces the key only when a new one is given.
   * Switching provider without a new key drops the old one.
   */
  public void save(long userId, Provider provider, String model, String newKey) {
    String cleanModel = model == null ? "" : model.trim();
    if (cleanModel.isEmpty() || cleanModel.length() > 200) throw new UserError("Bitte ein Modell auswählen.");
    if (newKey != null && !newKey.isBlank()) {
      String key = newKey.trim();
      if (key.length() > 500) throw new UserError("Das sieht nicht nach einem API-Schlüssel aus.");
      jdbc.sql("""
          INSERT INTO coach_settings (user_id, provider, model, api_key_enc, api_key_hint)
          VALUES (?,?,?,?,?)
          ON CONFLICT (user_id) DO UPDATE SET provider = EXCLUDED.provider, model = EXCLUDED.model,
            api_key_enc = EXCLUDED.api_key_enc, api_key_hint = EXCLUDED.api_key_hint, updated_at = now()""")
          .params(userId, provider.id, cleanModel, cipher.encrypt(userId, key), hint(key))
          .update();
    } else {
      jdbc.sql("""
          INSERT INTO coach_settings (user_id, provider, model) VALUES (?,?,?)
          ON CONFLICT (user_id) DO UPDATE SET provider = EXCLUDED.provider, model = EXCLUDED.model,
            -- A key is only good for the provider it was issued by.
            api_key_enc = CASE WHEN coach_settings.provider = EXCLUDED.provider THEN coach_settings.api_key_enc END,
            api_key_hint = CASE WHEN coach_settings.provider = EXCLUDED.provider THEN coach_settings.api_key_hint END,
            updated_at = now()""")
          .params(userId, provider.id, cleanModel)
          .update();
    }
  }

  public void deleteKey(long userId) {
    jdbc.sql("UPDATE coach_settings SET api_key_enc = NULL, api_key_hint = NULL, updated_at = now() WHERE user_id = ?")
        .param(userId).update();
  }

  public Credentials credentials(long userId) {
    record Row(String provider, String model, byte[] key) {}
    Row row = jdbc.sql("SELECT provider, model, api_key_enc FROM coach_settings WHERE user_id = ?")
        .param(userId)
        .query((rs, i) -> new Row(rs.getString(1), rs.getString(2), rs.getBytes(3)))
        .optional()
        .orElseThrow(() -> new UserError("Der Coach ist noch nicht eingerichtet: Anbieter, Modell und API-Schlüssel fehlen."));
    if (row.key() == null) throw new UserError("Es ist noch kein API-Schlüssel hinterlegt.");
    Provider provider = Provider.byId(row.provider()).orElseThrow(() -> new UserError("Unbekannter Anbieter."));
    return new Credentials(provider, row.model(), cipher.decrypt(userId, row.key()));
  }

  static String hint(String key) {
    return key.length() <= 8 ? "…" : "…" + key.substring(key.length() - 4);
  }
}
