package com.vocabcoach.lessons;

import static org.assertj.core.api.Assertions.assertThat;

import com.vocabcoach.config.AppProperties;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

/** Parsing only - nothing here talks to YouTube. */
class YouTubeTest {

  private final JsonMapper json = JsonMapper.builder().build();
  private final YouTube youtube = new YouTube(new AppProperties(null, null, null, null, null, null), json);

  @Test
  void searchIsOffWithoutAKey() {
    assertThat(youtube.searchAvailable()).isFalse();
  }

  @Test
  void videoDetailsBecomeShortEntries() {
    var videos = YouTube.parseVideos(json.readTree("""
        {"items":[{"id":"abcdefghijk","snippet":{"title":"En el restaurante","channelTitle":"Español Fácil",
          "description":"Diálogo","defaultAudioLanguage":"es"},
          "contentDetails":{"duration":"PT8M5S","caption":"true"}},
         {"id":"bcdefghijkl","snippet":{"title":"Podcast","channelTitle":"X","description":""},
          "contentDetails":{"duration":"PT1H2M3S","caption":"false"}}]}"""));
    assertThat(videos).hasSize(2);
    assertThat(videos.get(0).duration()).isEqualTo("8:05");
    assertThat(videos.get(0).hasCaptions()).isTrue();
    assertThat(videos.get(0).audioLanguage()).isEqualTo("es");
    assertThat(videos.get(1).duration()).isEqualTo("1:02:03");
    assertThat(videos.get(1).hasCaptions()).isFalse();
  }

  @Test
  void findsCaptionTracksInTheWatchPageAndPrefersHumanSpanish() {
    String html = "<script>var ytInitialPlayerResponse = {\"captions\":{\"playerCaptionsTracklistRenderer\":"
        + "{\"captionTracks\":[{\"baseUrl\":\"https://www.youtube.com/api/timedtext?v=x\\u0026lang=en\","
        + "\"languageCode\":\"en\",\"name\":{\"simpleText\":\"English [x]\"}},"
        + "{\"baseUrl\":\"https://www.youtube.com/api/timedtext?v=x\\u0026lang=es\\u0026kind=asr\","
        + "\"languageCode\":\"es\",\"kind\":\"asr\"},"
        + "{\"baseUrl\":\"https://www.youtube.com/api/timedtext?v=x\\u0026lang=es-ES\",\"languageCode\":\"es-ES\"}]"
        + ",\"audioTracks\":[]}}};</script>";
    var tracks = youtube.captionTracks(html);
    assertThat(tracks).hasSize(3);
    var picked = YouTube.pickTrack(tracks, "es").orElseThrow();
    assertThat(picked.path("languageCode").asString()).isEqualTo("es-ES");
    assertThat(picked.path("baseUrl").asString()).isEqualTo("https://www.youtube.com/api/timedtext?v=x&lang=es-ES");
  }

  @Test
  void automaticSpanishIsTheFallbackAndNoSpanishMeansNothing() {
    var onlyAuto = json.readTree("[{\"languageCode\":\"en\"},{\"languageCode\":\"es\",\"kind\":\"asr\"}]");
    assertThat(YouTube.pickTrack(onlyAuto, "es").orElseThrow().path("kind").asString()).isEqualTo("asr");
    assertThat(YouTube.pickTrack(json.readTree("[{\"languageCode\":\"en\"}]"), "es")).isEmpty();
    // The English course picks English subtitles from the same list.
    assertThat(YouTube.pickTrack(onlyAuto, "en").orElseThrow().path("languageCode").asString()).isEqualTo("en");
    assertThat(youtube.captionTracks("<html>keine Untertitel</html>")).isEmpty();
  }

  @Test
  void readsBothCaptionFormats() {
    String json3 = """
        {"events":[{"tStartMs":0,"segs":[{"utf8":"Hola, "},{"utf8":"¿qué tal?"}]},
                   {"tStartMs":900,"segs":[{"utf8":"\\n"}]},
                   {"tStartMs":1500,"segs":[{"utf8":"Hoy vamos\\nal mercado."}]}]}""";
    assertThat(youtube.captionText(json3)).isEqualTo("Hola, ¿qué tal?\nHoy vamos al mercado.");
    String xml = "<?xml version=\"1.0\"?><transcript><text start=\"0\" dur=\"1\">Hola &amp;amp; adiós</text>"
        + "<text start=\"1\" dur=\"1\">&#39;Vale&#39;</text></transcript>";
    assertThat(youtube.captionText(xml)).isEqualTo("Hola & adiós\n'Vale'");
  }
}
