package com.vocabcoach.coach;

import com.vocabcoach.UserError;
import com.vocabcoach.auth.CurrentUser;
import com.vocabcoach.auth.UserAccounts;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/** Coach settings and runs for the logged-in learner. */
@RestController
@RequestMapping("/api/coach")
public class CoachController {

  public record SettingsUpdate(String provider, String model, String apiKey) {}

  public record RunRequest(String task, String note) {}

  private final CoachSettings settings;
  private final CoachRunner runner;
  private final LlmClient llm;
  private final KeyCipher cipher;
  private final UserAccounts accounts;

  public CoachController(CoachSettings settings, CoachRunner runner, LlmClient llm, KeyCipher cipher,
                         UserAccounts accounts) {
    this.accounts = accounts;
    this.settings = settings;
    this.runner = runner;
    this.llm = llm;
    this.cipher = cipher;
  }

  /** Current settings - the key itself is never sent back, only its last characters. */
  @GetMapping("/settings")
  public Map<String, Object> getSettings() {
    Map<String, Object> out = new LinkedHashMap<>();
    var s = settings.find(CurrentUser.id());
    out.put("provider", s.map(x -> x.provider().id).orElse(null));
    out.put("model", s.map(CoachSettings.Settings::model).orElse(null));
    out.put("hasKey", s.map(CoachSettings.Settings::hasKey).orElse(false));
    out.put("keyHint", s.map(CoachSettings.Settings::keyHint).orElse(null));
    out.put("encryptionAvailable", cipher.available());
    out.put("providers", Arrays.stream(Provider.values())
        .map(p -> Map.of("id", p.id, "label", p.label, "keysPage", p.keysPage)).toList());
    return out;
  }

  @PutMapping("/settings")
  public Map<String, Object> putSettings(@RequestBody SettingsUpdate u) {
    long userId = CurrentUser.id();
    Provider provider = Provider.byId(u.provider()).orElseThrow(() -> new UserError("Bitte einen Anbieter wählen."));
    boolean newKey = u.apiKey() != null && !u.apiKey().isBlank();
    if (newKey) {
      llm.checkKey(provider, u.apiKey().trim());
    } else if (settings.find(userId).map(s -> !s.hasKey()).orElse(true)) {
      throw new UserError("Bitte einen API-Schlüssel eingeben.");
    }
    settings.save(userId, provider, u.model(), newKey ? u.apiKey() : null);
    return getSettings();
  }

  @DeleteMapping("/settings/key")
  public Map<String, Object> deleteKey() {
    settings.deleteKey(CurrentUser.id());
    return getSettings();
  }

  @GetMapping("/models")
  public List<LlmClient.Model> models(@RequestParam String provider) {
    Provider p = Provider.byId(provider).orElseThrow(() -> new UserError("Unbekannter Anbieter."));
    long userId = CurrentUser.id();
    // Some providers list models only for a valid key; use the stored one if it fits.
    boolean ownKey = settings.find(userId).map(s -> s.provider() == p && s.hasKey()).orElse(false);
    return llm.models(p, ownKey ? settings.credentials(userId).apiKey() : null);
  }

  @PostMapping("/runs")
  @ResponseStatus(HttpStatus.ACCEPTED)
  public Map<String, Object> start(@RequestBody RunRequest r) {
    return runner.start(accounts.currentLearner(), r.task() == null ? "" : r.task(), r.note());
  }

  @GetMapping("/runs")
  public List<Map<String, Object>> runs(@RequestParam(defaultValue = "10") int limit) {
    return runner.list(accounts.currentLearner(), Math.max(1, Math.min(limit, 50)));
  }

  @GetMapping("/runs/{id}")
  public Map<String, Object> run(@PathVariable long id) {
    return runner.find(CurrentUser.id(), id)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Kein solcher Lauf."));
  }
}
