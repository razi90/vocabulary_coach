package com.vocabcoach.coach;

import com.vocabcoach.UserError;
import com.vocabcoach.config.AppProperties;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Encrypts the learners' API keys with AES-256-GCM.
 *
 * <p>The master key comes from APP_ENCRYPTION_KEY and never touches the
 * database, so a database dump alone reveals no API key. The user id is
 * bound in as associated data: a ciphertext copied to another account's row
 * does not decrypt.
 */
@Component
public class KeyCipher {

  private static final Logger log = LoggerFactory.getLogger(KeyCipher.class);
  private static final int NONCE_BYTES = 12;
  private static final int TAG_BITS = 128;

  private final SecretKey key;
  private final SecureRandom random = new SecureRandom();

  public KeyCipher(AppProperties props) {
    this.key = parse(props.encryptionKey());
    if (key == null) {
      log.warn("APP_ENCRYPTION_KEY fehlt oder ist ungültig - der Coach kann keine API-Schlüssel speichern.");
    }
  }

  static SecretKey parse(String base64) {
    if (base64 == null || base64.isBlank()) return null;
    try {
      byte[] raw = Base64.getDecoder().decode(base64.trim());
      return raw.length == 32 ? new SecretKeySpec(raw, "AES") : null;
    } catch (IllegalArgumentException e) {
      return null;
    }
  }

  public boolean available() {
    return key != null;
  }

  public byte[] encrypt(long userId, String plain) {
    requireKey();
    try {
      byte[] nonce = new byte[NONCE_BYTES];
      random.nextBytes(nonce);
      Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
      c.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, nonce));
      c.updateAAD(aad(userId));
      byte[] sealed = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
      return ByteBuffer.allocate(nonce.length + sealed.length).put(nonce).put(sealed).array();
    } catch (GeneralSecurityException e) {
      throw new IllegalStateException("Verschlüsselung fehlgeschlagen", e);
    }
  }

  public String decrypt(long userId, byte[] stored) {
    requireKey();
    try {
      Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
      c.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, stored, 0, NONCE_BYTES));
      c.updateAAD(aad(userId));
      return new String(c.doFinal(Arrays.copyOfRange(stored, NONCE_BYTES, stored.length)), StandardCharsets.UTF_8);
    } catch (GeneralSecurityException e) {
      throw new UserError("Der gespeicherte API-Schlüssel lässt sich nicht entschlüsseln "
          + "(wurde APP_ENCRYPTION_KEY geändert?). Bitte den Schlüssel neu eingeben.");
    }
  }

  private void requireKey() {
    if (key == null) {
      throw new UserError("Der Server hat keinen APP_ENCRYPTION_KEY - API-Schlüssel lassen sich nicht speichern. "
          + "Bitte die Person fragen, die den Server betreibt.");
    }
  }

  private static byte[] aad(long userId) {
    return ("vocab-coach:user:" + userId).getBytes(StandardCharsets.UTF_8);
  }
}
