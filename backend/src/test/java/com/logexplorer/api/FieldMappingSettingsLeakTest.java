package com.logexplorer.api;

import static org.assertj.core.api.Assertions.assertThat;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.logexplorer.core.mapping.FieldMappingProfileService;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.SourceCapabilities;
import com.logexplorer.source.StubLogSource;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.http.MediaType;
import org.springframework.test.web.reactive.server.WebTestClient;
import reactor.core.publisher.Flux;

/**
 * Mission "Configurable Log Field Mapping + Original JSON Sampling" §4/§20/
 * §29 — Original Source JSON must never be logged, at the same realistic
 * DEBUG troubleshooting ceiling {@link LogLeakTest} already establishes for
 * the five protected search filters. Covers the sample-fetch endpoint AND
 * the validate endpoint (mission §16 deliberately echoes real unmasked
 * example values in its response — that response must still never be
 * *logged*, even though it IS returned to the caller by design).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class FieldMappingSettingsLeakTest {

  private static final String RAW_CIF_IN_SAMPLE = "RAW-ORIGINAL-JSON-CIF-SENTINEL-9d3f";

  @TestConfiguration
  static class TestSourceConfig {
    @Bean
    StubLogSource mappingLeakTestSource() {
      StubLogSource stub = new StubLogSource("mapping-leak-test-source", "Mapping Leak Test Source",
          new SourceCapabilities(true, false, false, false, false, false, false, true));
      stub.withSearchFlux(Flux.just(
          CanonicalLogEvent.builder()
              .timestamp(Instant.parse("2026-01-01T00:00:30Z"))
              .sourceTimestamp(Instant.parse("2026-01-01T00:00:30Z"))
              .message("ordinary event")
              .originalRawJson("{\"cif\":\"" + RAW_CIF_IN_SAMPLE + "\"}")
              .build()));
      return stub;
    }
  }

  @Autowired
  private WebTestClient webTestClient;

  @Autowired
  private FieldMappingProfileService profileService;

  private Logger rootLogger;
  private Level originalLevel;
  private ListAppender<ILoggingEvent> appender;

  @BeforeEach
  void attachCapturingAppender() {
    rootLogger = (Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME);
    originalLevel = rootLogger.getLevel();
    rootLogger.setLevel(Level.DEBUG);
    appender = new ListAppender<>();
    appender.list = new CopyOnWriteArrayList<>();
    appender.start();
    rootLogger.addAppender(appender);
  }

  @AfterEach
  void detachCapturingAppenderAndResetProfile() {
    rootLogger.detachAppender(appender);
    rootLogger.setLevel(originalLevel);
    profileService.resetToDefault();
  }

  @Test
  void sampleFetchNeverLogsTheOriginalJsonContent() {
    webTestClient.post().uri("/api/v1/sources/mapping-leak-test-source/field-mapping/samples")
        .exchange()
        .expectStatus().isOk()
        .expectBody(String.class)
        .value(body -> assertThat(body).contains(RAW_CIF_IN_SAMPLE)); // it IS in the response, by design

    assertNothingRawWasLogged();
  }

  @Test
  void validateWithRealSampleValuesNeverLogsThem() {
    String body = """
        {"proposedCandidates":{"cif":["cif"]},"samples":["{\\"cif\\":\\"%s\\"}"]}
        """.formatted(RAW_CIF_IN_SAMPLE);

    webTestClient.post().uri("/api/v1/settings/field-mapping/validate")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isOk()
        .expectBody(String.class)
        .value(responseBody -> assertThat(responseBody).contains(RAW_CIF_IN_SAMPLE)); // echoed in the response, by design

    assertNothingRawWasLogged();
  }

  @Test
  void invalidPathFailsSafelyWithA400_neverA500_pathsThemselvesAreVisibleConfigurationNotSecretSampleData() {
    // Candidate PATHS (e.g. "mdc.cif") are visible, user-authored
    // configuration, not the Original Source JSON sample VALUES mission
    // §4 protects - a validation error naming the invalid path is normal,
    // helpful config-error UX (mission §21: "invalid paths must fail
    // safely"), not a leak. What this test actually guards is "no 500,
    // no unhandled exception."
    String body = """
        {"candidatePaths":["mdc..not-a-valid-path"]}
        """;

    webTestClient.put().uri("/api/v1/settings/field-mapping/fields/cif")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isBadRequest();
  }

  private void assertNothingRawWasLogged() {
    List<String> messages = appender.list.stream().map(this::renderFully).toList();
    assertThat(String.join("\n", messages)).doesNotContain(RAW_CIF_IN_SAMPLE);
  }

  private String renderFully(ILoggingEvent event) {
    StringBuilder sb = new StringBuilder("[" + event.getLoggerName() + "] " + event.getFormattedMessage());
    if (event.getThrowableProxy() != null) {
      sb.append(' ').append(event.getThrowableProxy().getMessage());
    }
    for (Object arg : event.getArgumentArray() == null ? new Object[0] : event.getArgumentArray()) {
      sb.append(' ').append(String.valueOf(arg));
    }
    return sb.toString();
  }
}
