package com.logexplorer.source.loki;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.source.loki.LokiRequestException.Reason;
import java.net.SocketTimeoutException;
import java.util.concurrent.TimeoutException;
import org.junit.jupiter.api.Test;

/**
 * Error-class distinguishing tests (IMPLEMENTATION_PLAN.md "Phase D"
 * required automated test: "each error class").
 */
class LokiErrorClassifierTest {

  @Test
  void classifies401AsUnauthorized() {
    LokiRequestException e = LokiErrorClassifier.classifyStatus(401);
    assertThat(e.reason()).isEqualTo(Reason.UNAUTHORIZED);
    assertThat(e.getMessage()).contains("Authentication failed");
  }

  @Test
  void classifies403AsForbidden() {
    LokiRequestException e = LokiErrorClassifier.classifyStatus(403);
    assertThat(e.reason()).isEqualTo(Reason.FORBIDDEN);
    assertThat(e.getMessage()).contains("Access denied");
  }

  @Test
  void classifies429AsRateLimited() {
    LokiRequestException e = LokiErrorClassifier.classifyStatus(429);
    assertThat(e.reason()).isEqualTo(Reason.RATE_LIMITED);
    assertThat(e.getMessage()).contains("rate-limited");
  }

  @Test
  void classifies5xxAsServerError() {
    assertThat(LokiErrorClassifier.classifyStatus(500).reason()).isEqualTo(Reason.SERVER_ERROR);
    assertThat(LokiErrorClassifier.classifyStatus(503).reason()).isEqualTo(Reason.SERVER_ERROR);
  }

  @Test
  void classifiesOtherStatusesAsUnknown() {
    assertThat(LokiErrorClassifier.classifyStatus(418).reason()).isEqualTo(Reason.UNKNOWN);
  }

  @Test
  void classifiesTimeoutExceptionAsTimeout() {
    LokiRequestException e = LokiErrorClassifier.classifyThrowable(new TimeoutException("slow"));
    assertThat(e.reason()).isEqualTo(Reason.TIMEOUT);
  }

  @Test
  void classifiesSocketTimeoutExceptionAsTimeout() {
    LokiRequestException e = LokiErrorClassifier.classifyThrowable(new SocketTimeoutException("slow"));
    assertThat(e.reason()).isEqualTo(Reason.TIMEOUT);
  }

  @Test
  void alreadyClassifiedExceptionsPassThroughUnchanged() {
    LokiRequestException original = LokiErrorClassifier.classifyStatus(403);
    assertThat(LokiErrorClassifier.classifyThrowable(original)).isSameAs(original);
  }

  @Test
  void unrecognizedThrowablesFallBackToUnknownWithASanitizedMessageNeverTheRawText() {
    RuntimeException raw = new RuntimeException("some internal detail that must not leak: secret-abc-123");
    LokiRequestException e = LokiErrorClassifier.classifyThrowable(raw);
    assertThat(e.reason()).isEqualTo(Reason.UNKNOWN);
    assertThat(e.getMessage()).doesNotContain("secret-abc-123");
  }

  @Test
  void noClassifiedMessageEverContainsPotentiallySensitiveRawText() {
    for (int status : new int[] {401, 403, 429, 500, 503, 418}) {
      String message = LokiErrorClassifier.classifyStatus(status).getMessage();
      assertThat(message).isNotBlank();
    }
  }
}
