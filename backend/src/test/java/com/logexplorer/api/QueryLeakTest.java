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
 * Same technique as {@code LogLeakTest}/{@code LokiTokenLeakTest} (root
 * Logback appender raised to DEBUG), applied to the DSL {@code query} and
 * {@code rawLogQl} fields (IMPLEMENTATION_PLAN.md "Phase E": the DSL's own
 * literal values are exactly the class of "search value" CLAUDE.md's
 * "never log search values" rule covers) — for a successful search, a DSL
 * syntax error, and a raw-LogQL rejection.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class QueryLeakTest {

  private static final String RAW_QUERY_LITERAL = "RAW-QUERY-LITERAL-SENTINEL-2d9a";
  private static final String RAW_LOGQL_LITERAL = "RAW-LOGQL-SENTINEL-2d9a";

  @TestConfiguration
  static class TestSourceConfig {
    @Bean
    StubLogSource queryLeakTestSource() {
      StubLogSource stub = new StubLogSource("query-leak-test-source", "Query Leak Test Source",
          new SourceCapabilities(true, false, false, false, false, false));
      stub.withSearchFlux(Flux.just(
          CanonicalLogEvent.builder().timestamp(Instant.parse("2026-01-01T00:00:30Z")).message("ordinary event").build()));
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
  void successfulSearchWithADslQueryNeverLogsTheRawLiteral() {
    String body = """
        {"sourceId":"query-leak-test-source","start":"2026-01-01T00:00:00Z","end":"2026-01-01T01:00:00Z",
         "query":"message contains \\"%s\\""}
        """.formatted(RAW_QUERY_LITERAL);

    webTestClient.post().uri("/api/v1/logs/search")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isOk();

    assertNothingRawWasLogged(RAW_QUERY_LITERAL);
  }

  @Test
  void aDslSyntaxErrorNeverLogsOrReturnsTheRawLiteral() {
    String body = """
        {"sourceId":"query-leak-test-source","start":"2026-01-01T00:00:00Z","end":"2026-01-01T01:00:00Z",
         "query":"bogusField = \\"%s\\""}
        """.formatted(RAW_QUERY_LITERAL);

    String responseBody = webTestClient.post().uri("/api/v1/logs/search")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isBadRequest()
        .expectBody(String.class)
        .returnResult()
        .getResponseBody();

    assertThat(responseBody).doesNotContain(RAW_QUERY_LITERAL);
    assertNothingRawWasLogged(RAW_QUERY_LITERAL);
  }

  @Test
  void aRejectedRawLogQlRequestNeverLogsOrReturnsTheRawText() {
    String body = """
        {"sourceId":"query-leak-test-source","start":"2026-01-01T00:00:00Z","end":"2026-01-01T01:00:00Z",
         "rawLogQl":"{namespace=\\"%s\\"}"}
        """.formatted(RAW_LOGQL_LITERAL);

    String responseBody = webTestClient.post().uri("/api/v1/logs/search")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isBadRequest()
        .expectBody(String.class)
        .returnResult()
        .getResponseBody();

    assertThat(responseBody).doesNotContain(RAW_LOGQL_LITERAL);
    assertNothingRawWasLogged(RAW_LOGQL_LITERAL);
  }

  private void assertNothingRawWasLogged(String sentinel) {
    List<String> messages = appender.list.stream().map(this::renderFully).toList();
    assertThat(String.join("\n", messages)).doesNotContain(sentinel);
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
