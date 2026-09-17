package com.logexplorer.source.openshift;

import static org.assertj.core.api.Assertions.assertThat;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import java.net.URI;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

/**
 * OPENSHIFT_REAL_ENVIRONMENT_BUFFER_BUG_RECOVERY_2 Step 1A "LOGGING
 * SECURITY — HARD REQUIREMENT" — {@code LOG_SECRET_LEAK_TEST=PASS} is
 * mandatory. Captures every log line the new {@link
 * OpenShiftConnectDiagnostics}/buffer-diagnostics instrumentation emits
 * (at DEBUG, the most verbose level a deployment would reasonably enable
 * for troubleshooting — never TRACE in production) for one full real-TLS
 * {@link OpenShiftConnectionService#connect} attempt, across every
 * required outcome, and asserts the synthetic bearer token and the raw
 * pasted {@code oc login} command never appear in any captured line.
 *
 * <p>Uses a synthetic, obviously-fake token — never a real credential, and
 * never anything resembling the token the owner's screenshot exposed (this
 * mission's own explicit security instruction).
 */
class OpenShiftConnectLogSecurityTest {

  private static final String SYNTHETIC_TOKEN_SECRET = "sha256~synthetic-log-leak-test-token-do-not-reuse";
  private static final com.logexplorer.core.model.RawToken TOKEN =
      com.logexplorer.core.model.RawToken.of(SYNTHETIC_TOKEN_SECRET);

  private MockOpenShiftHttpsServer server;
  private OpenShiftConnectionService service;
  private String syntheticLoginCommand;
  private ListAppender<ILoggingEvent> appender;
  private Logger connectLogger;
  private Logger bufferLogger;
  private Logger clientPackageLogger;

  @BeforeEach
  void setUp() throws Exception {
    server = new MockOpenShiftHttpsServer();
    OpenShiftApiClient client = new OpenShiftApiClient(Map.of());
    service = new OpenShiftConnectionService(client, new OpenShiftSession(), new LoopbackBindingGuard("127.0.0.1"));
    syntheticLoginCommand = "oc login --token=" + SYNTHETIC_TOKEN_SECRET + " --server=" + server.baseUrl()
        + " --certificate-authority=" + server.caPemPath();

    appender = new ListAppender<>();
    appender.start();
    connectLogger = (Logger) LoggerFactory.getLogger("com.logexplorer.source.openshift.connect");
    bufferLogger = (Logger) LoggerFactory.getLogger("com.logexplorer.source.openshift.buffer");
    clientPackageLogger = (Logger) LoggerFactory.getLogger("com.logexplorer.source.openshift");
    for (Logger l : List.of(connectLogger, bufferLogger, clientPackageLogger)) {
      l.addAppender(appender);
      l.setLevel(Level.DEBUG); // the most verbose level a real deployment would enable - never TRACE by default
    }
  }

  @AfterEach
  void tearDown() {
    for (Logger l : List.of(connectLogger, bufferLogger, clientPackageLogger)) {
      l.detachAppender(appender);
    }
    if (server != null) {
      server.close();
    }
  }

  private List<String> capturedMessages() {
    return appender.list.stream().map(ILoggingEvent::getFormattedMessage).toList();
  }

  private void assertNoSecretLeaked() {
    List<String> messages = capturedMessages();
    assertThat(messages).isNotEmpty(); // the instrumentation must have actually run
    for (String message : messages) {
      assertThat(message)
          .as("captured log line must never contain the bearer token")
          .doesNotContain(SYNTHETIC_TOKEN_SECRET)
          .doesNotContainIgnoringCase("bearer " + SYNTHETIC_TOKEN_SECRET);
      assertThat(message)
          .as("captured log line must never contain the raw oc login command")
          .doesNotContain(syntheticLoginCommand);
    }
  }

  @Test
  void logSecretLeakTest_successfulConnection() {
    server.setScenario(MockOpenShiftServer.Scenario.OK);
    service.connect(syntheticLoginCommand, "test-connection").block();
    assertNoSecretLeaked();
  }

  @Test
  void logSecretLeakTest_401() {
    server.setScenario(MockOpenShiftServer.Scenario.UNAUTHORIZED_401);
    org.assertj.core.api.Assertions.catchThrowable(
        () -> service.connect(syntheticLoginCommand, "test-connection").block());
    assertNoSecretLeaked();
  }

  @Test
  void logSecretLeakTest_403() {
    server.setScenario(MockOpenShiftServer.Scenario.FORBIDDEN_403);
    org.assertj.core.api.Assertions.catchThrowable(
        () -> service.connect(syntheticLoginCommand, "test-connection").block());
    assertNoSecretLeaked();
  }

  @Test
  void logSecretLeakTest_500() {
    server.setScenario(MockOpenShiftServer.Scenario.INTERNAL_SERVER_ERROR_500);
    org.assertj.core.api.Assertions.catchThrowable(
        () -> service.connect(syntheticLoginCommand, "test-connection").block());
    assertNoSecretLeaked();
  }

  @Test
  void logSecretLeakTest_malformedResponse() {
    server.setScenario(MockOpenShiftServer.Scenario.MALFORMED_BODY);
    org.assertj.core.api.Assertions.catchThrowable(
        () -> service.connect(syntheticLoginCommand, "test-connection").block());
    assertNoSecretLeaked();
  }

  @Test
  void logSecretLeakTest_connectionFailure() {
    // A server this client can never reach - the connection-level failure
    // path (NETWORK/TLS), never a real host/credential.
    server.close();
    org.assertj.core.api.Assertions.catchThrowable(
        () -> service.connect(syntheticLoginCommand, "test-connection").block());
    assertNoSecretLeaked();
    server = null; // already closed - do not double-close in tearDown
  }
}
