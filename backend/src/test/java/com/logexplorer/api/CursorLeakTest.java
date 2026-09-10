package com.logexplorer.api;

import static org.assertj.core.api.Assertions.assertThat;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.RawSensitiveFields;
import com.logexplorer.core.model.SourceCapabilities;
import com.logexplorer.source.StubLogSource;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.stream.IntStream;
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
 * Legacy Remediation Slice 1 — same technique as {@code QueryLeakTest}/
 * {@code LogLeakTest} (root Logback appender raised to DEBUG, plus response
 * body inspection), applied specifically to the pagination cursor: it must
 * never contain a raw sensitive value verbatim, and an invalid/tampered
 * cursor's error response must never echo the cursor's own value or any
 * decoded content.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class CursorLeakTest {

  private static final String RAW_CIF = "RAW-CIF-CURSOR-SENTINEL-7e1c";
  private static final String RAW_CUSTOMER_ID = "RAW-CUSTOMERID-CURSOR-SENTINEL-7e1c";

  @TestConfiguration
  static class TestSourceConfig {
    @Bean
    StubLogSource cursorLeakTestSource() {
      StubLogSource stub = new StubLogSource("cursor-leak-test-source", "Cursor Leak Test Source",
          new SourceCapabilities(true, false, false, false, false, false, false));
      List<CanonicalLogEvent> events = IntStream.range(0, 5)
          .mapToObj(i -> CanonicalLogEvent.builder()
              .timestamp(Instant.parse("2026-01-01T00:00:00Z").minusSeconds(i))
              .message("event " + i)
              .sensitive(new RawSensitiveFields(RAW_CIF, null, RAW_CUSTOMER_ID, null, null))
              .build())
          .toList();
      stub.withSearchFlux(Flux.fromIterable(events));
      return stub;
    }
  }

  @Autowired
  private WebTestClient webTestClient;

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
  void detachCapturingAppender() {
    rootLogger.detachAppender(appender);
    rootLogger.setLevel(originalLevel);
  }

  @Test
  void aRealCursorNeverContainsAnyRawSensitiveFilterValueVerbatim() {
    String body = """
        {"sourceId":"cursor-leak-test-source","start":"2025-12-31T00:00:00Z","end":"2026-01-02T00:00:00Z",
         "limit":3,"cif":"%s","customerId":"%s"}
        """.formatted(RAW_CIF, RAW_CUSTOMER_ID);

    String responseBody = webTestClient.post().uri("/api/v1/logs/search")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isOk()
        .expectBody(String.class)
        .returnResult()
        .getResponseBody();

    assertThat(responseBody).contains("\"nextCursor\"");
    // The stub doesn't actually filter by the sensitive values (it ignores
    // the request entirely - see StubLogSource), so the search genuinely
    // returns all 5 events and truncates at limit=3, producing a real
    // cursor - what matters here is only what that cursor string contains.
    assertThat(responseBody).doesNotContain(RAW_CIF, RAW_CUSTOMER_ID);
    assertNothingRawWasLogged(RAW_CIF, RAW_CUSTOMER_ID);
  }

  @Test
  void anInvalidCursorResponseNeverEchoesTheCursorValueOrAnyDecodedContent() {
    String sentinelCursor = "GARBAGE-CURSOR-SENTINEL-MUST-NEVER-BE-ECHOED-4b2d";
    String body = """
        {"sourceId":"cursor-leak-test-source","start":"2025-12-31T00:00:00Z","end":"2026-01-02T00:00:00Z",
         "cursor":"%s"}
        """.formatted(sentinelCursor);

    String responseBody = webTestClient.post().uri("/api/v1/logs/search")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isBadRequest()
        .expectBody(String.class)
        .returnResult()
        .getResponseBody();

    assertThat(responseBody).doesNotContain(sentinelCursor);
    assertThat(responseBody).contains("INVALID_CURSOR");
    assertNothingRawWasLogged(sentinelCursor);
  }

  private void assertNothingRawWasLogged(String... sentinels) {
    List<String> messages = appender.list.stream().map(this::renderFully).toList();
    String rendered = String.join("\n", messages);
    for (String sentinel : sentinels) {
      assertThat(rendered).doesNotContain(sentinel);
    }
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
