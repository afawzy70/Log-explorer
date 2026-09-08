package com.logexplorer.source.loki;

/** A classified, sanitized Loki gateway failure. Maps to {@code SourceHealth} / a ProblemDetail upstream. */
public class LokiRequestException extends RuntimeException {

  public enum Reason { UNAUTHORIZED, FORBIDDEN, RATE_LIMITED, TIMEOUT, SERVER_ERROR, UNKNOWN }

  private final Reason reason;

  public LokiRequestException(Reason reason, String sanitizedMessage) {
    super(sanitizedMessage);
    this.reason = reason;
  }

  public Reason reason() {
    return reason;
  }
}
