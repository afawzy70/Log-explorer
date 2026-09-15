package com.logexplorer.core.classify;

import java.util.Map;

/**
 * A deterministic, user-actionable classification-rules failure with an
 * HTTP status and a stable machine-readable {@code reason}. Messages never
 * include event data or rule-file contents.
 */
public class ClassificationRulesException extends RuntimeException {

  private final int status;
  private final String reason;
  private final transient Map<String, Object> properties;

  public ClassificationRulesException(int status, String reason, String message, Map<String, Object> properties) {
    super(message);
    this.status = status;
    this.reason = reason;
    this.properties = properties == null ? Map.of() : Map.copyOf(properties);
  }

  public static ClassificationRulesException badRequest(String reason, String message) {
    return new ClassificationRulesException(400, reason, message, null);
  }

  public static ClassificationRulesException notFound(String reason, String message) {
    return new ClassificationRulesException(404, reason, message, null);
  }

  public static ClassificationRulesException conflict(String reason, String message, Map<String, Object> properties) {
    return new ClassificationRulesException(409, reason, message, properties);
  }

  public static ClassificationRulesException tooLarge(String reason, String message) {
    return new ClassificationRulesException(413, reason, message, null);
  }

  public static ClassificationRulesException unavailable(String reason, String message) {
    return new ClassificationRulesException(503, reason, message, null);
  }

  public int status() {
    return status;
  }

  public String reason() {
    return reason;
  }

  public Map<String, Object> properties() {
    return properties;
  }
}
