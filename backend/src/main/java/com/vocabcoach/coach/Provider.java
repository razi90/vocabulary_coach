package com.vocabcoach.coach;

import java.util.Arrays;
import java.util.Optional;

/**
 * The LLM gateways a learner can pick. Both speak the OpenAI Chat Completions
 * format with tool calling and route one key to many models, so a single
 * client covers both - only the addresses differ.
 */
public enum Provider {

  OPENROUTER("openrouter", "OpenRouter",
      "https://openrouter.ai/api/v1/chat/completions",
      // Only models that can call tools - the coach is useless without them.
      "https://openrouter.ai/api/v1/models?supported_parameters=tools",
      "https://openrouter.ai/api/v1/key",
      "https://openrouter.ai/keys"),

  OPENCODE_ZEN("opencode_zen", "OpenCode Zen",
      "https://opencode.ai/inference/openai/v1/chat/completions",
      "https://opencode.ai/inference/v1/models",
      null,
      "https://opencode.ai/auth");

  public final String id;
  public final String label;
  public final String chatUrl;
  public final String modelsUrl;
  /** Endpoint that answers 200 for a valid key, or null if the provider has none. */
  public final String keyCheckUrl;
  public final String keysPage;

  Provider(String id, String label, String chatUrl, String modelsUrl, String keyCheckUrl, String keysPage) {
    this.id = id;
    this.label = label;
    this.chatUrl = chatUrl;
    this.modelsUrl = modelsUrl;
    this.keyCheckUrl = keyCheckUrl;
    this.keysPage = keysPage;
  }

  public static Optional<Provider> byId(String id) {
    return Arrays.stream(values()).filter(p -> p.id.equals(id)).findFirst();
  }
}
