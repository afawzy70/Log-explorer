package com.logexplorer.api;

import static org.assertj.core.api.Assertions.assertThat;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
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
 * Captures real Logback output (root logger, temporarily raised to DEBUG —
 * the realistic troubleshooting ceiling; see below) during a search whose
 * request body contains sensitive filter values and free text, and asserts
 * none of the raw values appear anywhere in what was logged —
 * IMPLEMENTATION_PLAN.md "Phase B" required automated test ("capture logs
 * during a search containing sensitive filters and assert none of the raw
 * values appear").
 *
 * <p>Deliberately DEBUG, not TRACE: at TRACE, Spring's {@code WebClient}
 * ({@code ExchangeFunctions}/{@code LoggingCodecSupport}) logs full raw
 * request/response bodies — including this test's own {@code
 * WebTestClient} call into the app, which is test-harness traffic, not
 * anything the server itself does. At DEBUG, Spring logs only a method+path
 * summary, never the body; that is also the realistic ceiling anyone would
 * actually run in production troubleshooting (TRACE is never enabled
 * broadly — see {@code application.yml}, which additionally pins {@code
 * reactor.netty}/{@code io.netty} to INFO regardless of root, since those
 * specifically dump raw HTTP bytes at TRACE too).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class LogLeakTest {

  private static final String RAW_TEXT = "RAW-FREE-TEXT-SENTINEL-7c2e";
  private static final String RAW_CIF = "RAW-CIF-FILTER-SENTINEL-7c2e";
  private static final String RAW_USERNAME = "RAW-USERNAME-FILTER-SENTINEL-7c2e";
  private static final String RAW_CUSTOMER_ID = "RAW-CUSTOMERID-FILTER-SENTINEL-7c2e";
  private static final String RAW_DEVICE_ID = "RAW-DEVICEID-FILTER-SENTINEL-7c2e";
  private static final String RAW_DEVICE_IP = "198.51.100.77";

  @TestConfiguration
  static class TestSourceConfig {
    @Bean
    StubLogSource logLeakTestSource() {
      StubLogSource stub = new StubLogSource("log-leak-test-source", "Log Leak Test Source",
          new SourceCapabilities(true, false, false, false, false, false));
      stub.withSearchFlux(Flux.just(
          CanonicalLogEvent.builder()
              .timestamp(Instant.parse("2026-01-01T00:00:30Z"))
              .message("ordinary event")
              .service("gateway")
              .build()));
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
    // Background Reactor Netty threads keep appending after the response
    // returns; a plain ArrayList (ListAppender's default) is not safe to
    // read concurrently with those writes.
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
  void successfulSearchWithSensitiveFiltersNeverLogsAnyRawValue() {
    String body = """
        {"sourceId":"log-leak-test-source","start":"2026-01-01T00:00:00Z","end":"2026-01-01T01:00:00Z",
         "text":"%s","cif":"%s","userName":"%s","customerId":"%s","deviceId":"%s","deviceIp":"%s"}
        """.formatted(RAW_TEXT, RAW_CIF, RAW_USERNAME, RAW_CUSTOMER_ID, RAW_DEVICE_ID, RAW_DEVICE_IP);

    webTestClient.post().uri("/api/v1/logs/search")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isOk();

    assertNothingRawWasLogged();
  }

  @Test
  void guardrailViolationWithSensitiveFiltersStillDoesNotLogOrReturnRawValues() {
    // Invalid range (start after end) triggers the error-handling path,
    // including the exception's own message - must still be clean, in both
    // the ProblemDetail response body and everything logged.
    String body = """
        {"sourceId":"log-leak-test-source","start":"2026-01-01T01:00:00Z","end":"2026-01-01T00:00:00Z",
         "text":"%s","cif":"%s","userName":"%s","customerId":"%s","deviceId":"%s","deviceIp":"%s"}
        """.formatted(RAW_TEXT, RAW_CIF, RAW_USERNAME, RAW_CUSTOMER_ID, RAW_DEVICE_ID, RAW_DEVICE_IP);

    String responseBody = webTestClient.post().uri("/api/v1/logs/search")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isBadRequest()
        .expectBody(String.class)
        .returnResult()
        .getResponseBody();

    assertNothingRawAppearsIn(responseBody);
    assertNothingRawWasLogged();
  }

  @Test
  void unknownSourceWithSensitiveFiltersStillDoesNotLogOrReturnRawValues() {
    String body = """
        {"sourceId":"does-not-exist","start":"2026-01-01T00:00:00Z","end":"2026-01-01T01:00:00Z",
         "text":"%s","cif":"%s","userName":"%s","customerId":"%s","deviceId":"%s","deviceIp":"%s"}
        """.formatted(RAW_TEXT, RAW_CIF, RAW_USERNAME, RAW_CUSTOMER_ID, RAW_DEVICE_ID, RAW_DEVICE_IP);

    String responseBody = webTestClient.post().uri("/api/v1/logs/search")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isNotFound()
        .expectBody(String.class)
        .returnResult()
        .getResponseBody();

    assertNothingRawAppearsIn(responseBody);
    assertNothingRawWasLogged();
  }

  private void assertNothingRawWasLogged() {
    List<String> messages = appender.list.stream()
        .map(this::renderFully)
        .toList();
    assertNothingRawAppearsIn(String.join("\n", messages));
  }

  private void assertNothingRawAppearsIn(String text) {
    assertThat(text).doesNotContain(
        RAW_TEXT, RAW_CIF, RAW_USERNAME, RAW_CUSTOMER_ID, RAW_DEVICE_ID, RAW_DEVICE_IP);
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
