package com.vocabcoach.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class DevReloadTest {

  @TempDir Path web;

  @Test
  void savingAddingOrRemovingAFrontendFileChangesTheSignature() throws Exception {
    Path js = Files.writeString(web.resolve("app.js"), "a");
    Files.setLastModifiedTime(js, FileTime.fromMillis(1_000));
    DevReload.Signature before = DevReload.signature(web);

    Files.setLastModifiedTime(js, FileTime.fromMillis(2_000));        // saved
    DevReload.Signature saved = DevReload.signature(web);
    assertThat(saved).isNotEqualTo(before);

    Files.createDirectories(web.resolve("src"));
    Path css = Files.writeString(web.resolve("src/style.css"), "b");   // added, in a subfolder
    Files.setLastModifiedTime(css, FileTime.fromMillis(500));
    DevReload.Signature added = DevReload.signature(web);
    assertThat(added).isNotEqualTo(saved);

    Files.delete(css);                                                 // removed
    assertThat(DevReload.signature(web)).isEqualTo(saved);
  }

  @Test
  void otherFilesAreIgnored() throws Exception {
    DevReload.Signature before = DevReload.signature(web);
    Files.writeString(web.resolve("notes.md"), "x");
    Files.writeString(web.resolve("font.woff2"), "x");
    assertThat(DevReload.signature(web)).isEqualTo(before);
  }
}
