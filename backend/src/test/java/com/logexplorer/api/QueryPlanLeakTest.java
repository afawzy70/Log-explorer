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
 * "Add explicit leak tests covering: queryPlan.resolvedQuery, pushDown
 * conditions, postFilter conditions" (Legacy Remediation Slice 2,
 * {@code docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md} §"Slice 2" security
 * constraints). Same technique as {@code QueryLeakTest}/{@code LogLeakTest}
 * (root Logback appender raised to DEBUG) — a sentinel is planted in every
 * raw-value carrier a query plan could theoretically echo (the DSL literal,
 * free text, and all five protected structured filters) and proven absent
 * from both the HTTP response body and everything logged while building it.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class QueryPlanLeakTest {

  private static final String DSL_SENTINEL = "QPLAN-DSL-SENTINEL-c71f";
  private static final String TEXT_SENTINEL = "QPLAN-TEXT-SENTINEL-c71f";
  private static final String CIF_SENTINEL = "QPLAN-CIF-SENTINEL-c71f";
  private static final String USERNAME_SENTINEL = "QPLAN-USERNAME-SENTINEL-c71f";
  private static final String CUSTOMERID_SENTINEL = "QPLAN-CUSTOMERID-SENTINEL-c71f";
  private static final String DEVICEID_SENTINEL = "QPLAN-DEVICEID-SENTINEL-c71f";
  private static final String DEVICEIP_SENTINEL = "QPLAN-DEVICEIP-SENTINEL-c71f";

  private static final List<String> ALL_SENTINELS = List.of(
      DSL_SENTINEL, TEXT_SENTINEL, CIF_SENTINEL, USERNAME_SENTINEL, CUSTOMERID_SENTINEL, DEVICEID_SENTINEL, DEVICEIP_SENTINEL);

  @TestConfiguration
  static class TestSourceConfig {
    @Bean
    StubLogSource queryPlanLeakTestSource() {
      StubLogSource stub = new StubLogSource("query-plan-leak-test-source", "Query Plan Leak Test Source",
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
  void queryPlanNeverLeaksTheDslLiteralTheFreeTextOrAnyProtectedFieldValue() {
    String body = """
        {"sourceId":"query-plan-leak-test-source","start":"2026-01-01T00:00:00Z","end":"2026-01-01T01:00:00Z",
         "text":"%s",
         "query":"message contains \\"%s\\"",
         "cif":"%s","userName":"%s","customerId":"%s","deviceId":"%s","deviceIp":"%s"}
        """.formatted(TEXT_SENTINEL, DSL_SENTINEL, CIF_SENTINEL, USERNAME_SENTINEL, CUSTOMERID_SENTINEL, DEVICEID_SENTINEL, DEVICEIP_SENTINEL);

    String responseBody = webTestClient.post().uri("/api/v1/logs/search")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isOk()
        .expectBody(String.class)
        .returnResult()
        .getResponseBody();

    for (String sentinel : ALL_SENTINELS) {
      assertThat(responseBody).as("response body must not contain " + sentinel).doesNotContain(sentinel);
    }
    // Every field name is still expected to show up as a redacted marker -
    // proving the plan genuinely reflects these filters being active
    // rather than the whole feature silently doing nothing.
    assertThat(responseBody).contains("message contains ***", "cif = ***", "userName = ***", "customerId = ***",
        "deviceId = ***", "deviceIp = ***");

    assertNothingRawWasLogged();
  }

  @Test
  void aQueryPlanBuiltFromAnInvalidSensitiveOperatorQueryNeverLeaksTheAttemptedLiteral() {
    String body = """
        {"sourceId":"query-plan-leak-test-source","start":"2026-01-01T00:00:00Z","end":"2026-01-01T01:00:00Z",
         "query":"cif contains \\"%s\\""}
        """.formatted(DSL_SENTINEL);

    String responseBody = webTestClient.post().uri("/api/v1/logs/search")
        .contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body)
        .exchange()
        .expectStatus().isBadRequest()
        .expectBody(String.class)
        .returnResult()
        .getResponseBody();

    assertThat(responseBody).doesNotContain(DSL_SENTINEL);
    assertNothingRawWasLogged();
  }

  private void assertNothingRawWasLogged() {
    List<String> messages = appender.list.stream().map(this::renderFully).toList();
    String joined = String.join("\n", messages);
    for (String sentinel : ALL_SENTINELS) {
      assertThat(joined).as("logs must not contain " + sentinel).doesNotContain(sentinel);
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
