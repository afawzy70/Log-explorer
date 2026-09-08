package com.logexplorer.source.loki;

import static org.assertj.core.api.Assertions.assertThat;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.logexplorer.config.LokiProperties;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.slf4j.LoggerFactory;
import reactor.core.publisher.Mono;

/**
 * Captures real Logback output (root logger, raised to DEBUG - same
 * realistic-troubleshooting-ceiling justification as {@code
 * com.logexplorer.api.LogLeakTest}) during real {@link LokiQueryClient}
 * calls with a configured bearer token, and asserts the raw token value
 * never appears anywhere in what was logged - HANDOVER.md §6.5 "Token from
 * env/secret only, never logged", exercised for both the success and the
 * error path (an auth failure is exactly when a raw token would most
 * tempt showing up in a diagnostic message).
 */
class LokiTokenLeakTest {

  private static final String RAW_TOKEN = "RAW-LOKI-BEARER-TOKEN-SENTINEL-9f3a";

  @TempDir
  private Path tempDir;

  private MockLokiServer mockServer;
  private Logger rootLogger;
  private Level originalLevel;
  private ListAppender<ILoggingEvent> appender;

  @BeforeEach
  void setUp() throws IOException {
    mockServer = new MockLokiServer("/api/logs/v1", "application", "namespace", "app");

    rootLogger = (Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME);
    originalLevel = rootLogger.getLevel();
    rootLogger.setLevel(Level.DEBUG);
    appender = new ListAppender<>();
    appender.list = new CopyOnWriteArrayList<>();
    appender.start();
    rootLogger.addAppender(appender);
  }

  @AfterEach
  void tearDown() {
    rootLogger.detachAppender(appender);
    rootLogger.setLevel(originalLevel);
    mockServer.close();
  }

  private LokiProperties propertiesWithToken() throws IOException {
    Path tokenFile = tempDir.resolve("token.txt");
    Files.writeString(tokenFile, RAW_TOKEN);

    LokiProperties properties = new LokiProperties();
    properties.setBaseUrl(mockServer.baseUrl());
    properties.setGatewayPrefix("/api/logs/v1");
    properties.setTenant("application");
    properties.setTokenFilePath(tokenFile.toString());
    properties.setRequestTimeout(Duration.ofSeconds(2));
    return properties;
  }

  private LokiQueryClient clientFor(LokiProperties properties) {
    return new LokiQueryClient(properties, new LokiTokenSupplier(properties), new LokiWebClientFactory());
  }

  @Test
  void successfulQueryWithATokenNeverLogsTheRawTokenValue() throws IOException {
    LokiQueryClient client = clientFor(propertiesWithToken());

    client.queryRange("{namespace=\"x\"}", 1L, 2L, 10, "backward").block(Duration.ofSeconds(5));

    assertThat(mockServer.lastAuthorizationHeader()).isEqualTo("Bearer " + RAW_TOKEN);
    assertNothingRawWasLogged();
  }

  @Test
  void authFailureWithATokenStillNeverLogsTheRawTokenValue() throws IOException {
    mockServer.setScenario("401");
    LokiQueryClient client = clientFor(propertiesWithToken());

    Mono<LokiQueryResponse> call = client.queryRange("{namespace=\"x\"}", 1L, 2L, 10, "backward");
    try {
      call.block(Duration.ofSeconds(5));
    } catch (Exception expected) {
      // Expected - the 401 must surface as an error, we only care that
      // nothing about it (including the exception's own message) leaks
      // the raw token.
      assertThat(expected.getMessage()).doesNotContain(RAW_TOKEN);
    }

    assertNothingRawWasLogged();
  }

  private void assertNothingRawWasLogged() {
    List<String> messages = appender.list.stream().map(this::renderFully).toList();
    assertThat(String.join("\n", messages)).doesNotContain(RAW_TOKEN);
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
