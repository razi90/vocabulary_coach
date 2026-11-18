package com.vocabcoach.coach;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.vocabcoach.UserError;
import com.vocabcoach.config.AppProperties;
import java.util.Base64;
import org.junit.jupiter.api.Test;

class KeyCipherTest {

  private static KeyCipher cipher(String key) {
    return new KeyCipher(new AppProperties(key, null, null, null, null));
  }

  private static final String KEY = Base64.getEncoder().encodeToString(new byte[32]);

  @Test
  void roundTripsAndNeverStoresThePlainKey() {
    KeyCipher c = cipher(KEY);
    byte[] sealed = c.encrypt(7, "sk-or-v1-secret");
    assertThat(new String(sealed, java.nio.charset.StandardCharsets.ISO_8859_1)).doesNotContain("secret");
    assertThat(c.decrypt(7, sealed)).isEqualTo("sk-or-v1-secret");
  }

  @Test
  void aCiphertextIsBoundToItsUser() {
    KeyCipher c = cipher(KEY);
    byte[] sealed = c.encrypt(7, "sk-or-v1-secret");
    assertThatThrownBy(() -> c.decrypt(8, sealed)).isInstanceOf(UserError.class);
  }

  @Test
  void withoutAValidMasterKeyNothingIsStored() {
    assertThat(cipher("").available()).isFalse();
    assertThat(cipher("zu-kurz").available()).isFalse();
    assertThatThrownBy(() -> cipher(null).encrypt(1, "x")).isInstanceOf(UserError.class);
  }
}
