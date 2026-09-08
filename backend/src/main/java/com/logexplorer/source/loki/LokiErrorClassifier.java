package com.logexplorer.source.loki;

import com.logexplorer.source.loki.LokiRequestException.Reason;
import java.util.concurrent.TimeoutException;

/**
 * Classifies Loki gateway failures into fixed, sanitized messages
 * (IMPLEMENTATION_PLAN.md "Phase D" scope item 5: "Distinguish and
 * sanitize 401 / 403 / 429 / timeout / 5xx"). Every message is a constant
 * string chosen by classification — never the raw response body or
 * exception text, which could contain request details.
 */
public final class LokiErrorClassifier {

  private LokiErrorClassifier() {
  }

  public static LokiRequestException classifyStatus(int statusCode) {
    return switch (statusCode) {
      case 401 -> new LokiRequestException(Reason.UNAUTHORIZED,
          "Authentication failed calling the Loki gateway. Confirm the configured token is present and valid.");
      case 403 -> new LokiRequestException(Reason.FORBIDDEN,
          "Access denied calling the Loki gateway. Confirm the configured token has the required tenant/namespace access.");
      case 429 -> new LokiRequestException(Reason.RATE_LIMITED,
          "The Loki gateway rate-limited this request. Try again shortly or narrow the search.");
      default -> statusCode >= 500
          ? new LokiRequestException(Reason.SERVER_ERROR, "The Loki gateway returned a server error.")
          : new LokiRequestException(Reason.UNKNOWN, "The Loki gateway returned an unexpected response.");
    };
  }

  public static LokiRequestException classifyThrowable(Throwable t) {
    if (t instanceof LokiRequestException e) {
      return e;
    }
    if (t instanceof TimeoutException || t instanceof java.net.SocketTimeoutException) {
      return new LokiRequestException(Reason.TIMEOUT, "Timed out waiting for the Loki gateway to respond.");
    }
    return new LokiRequestException(Reason.UNKNOWN, "Could not complete the request to the Loki gateway.");
  }
}
