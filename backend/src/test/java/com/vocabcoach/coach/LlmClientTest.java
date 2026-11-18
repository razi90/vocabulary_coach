package com.vocabcoach.coach;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class LlmClientTest {

  private final JsonMapper json = JsonMapper.builder().build();

  @Test
  void zenFreeModelsAndModelsWithoutToolsAreHidden() {
    var free = json.readTree("""
        {"id":"big-pickle","type":"chat","capabilities":{"tools":{"supported":true}},
         "cost":{"text":{"input":{"price":0},"output":{"price":0}}}}""");
    var paid = json.readTree("""
        {"id":"kimi","type":"chat","capabilities":{"tools":{"supported":true}},
         "cost":{"text":{"input":{"price":0.6},"output":{"price":2.5}}}}""");
    var noTools = json.readTree("{\"id\":\"x\",\"capabilities\":{\"tools\":{\"supported\":false}}}");
    assertThat(LlmClient.usable(Provider.OPENCODE_ZEN, free)).isFalse();
    assertThat(LlmClient.usable(Provider.OPENCODE_ZEN, paid)).isTrue();
    assertThat(LlmClient.usable(Provider.OPENROUTER, noTools)).isFalse();
    // OpenRouter's list carries no such fields; it is pre-filtered by the URL.
    assertThat(LlmClient.usable(Provider.OPENROUTER, json.readTree("{\"id\":\"a/b\"}"))).isTrue();
  }

  @Test
  void errorsAreExplainedInGerman() {
    var body = json.readTree("{\"error\":{\"message\":\"Insufficient credits\",\"code\":402}}");
    assertThat(LlmClient.describe(Provider.OPENROUTER, 402, body, ""))
        .isEqualTo("Das Guthaben bei OpenRouter ist aufgebraucht. (Insufficient credits)");
    assertThat(LlmClient.describe(Provider.OPENCODE_ZEN, 401, json.createObjectNode(), ""))
        .startsWith("Der API-Schlüssel wurde abgelehnt.");
  }
}
