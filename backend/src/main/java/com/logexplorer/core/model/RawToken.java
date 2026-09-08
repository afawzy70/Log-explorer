package com.logexplorer.core.model;

/**
 * Wraps a bearer token so it can be passed around without ever being
 * logged by accident (HANDOVER.md §6.5: "Token from env/secret only,
 * never logged"). Same redact-by-type pattern as {@link
 * RawSensitiveFields}: {@link #toString()} always returns a fixed
 * redacted string, regardless of the actual value, so an accidental
 * {@code log.info("{}", token)} anywhere — now or in a future phase —
 * cannot leak it.
 */
public record RawToken(String value) {

  private static final RawToken EMPTY = new RawToken(null);

  public static RawToken empty() {
    return EMPTY;
  }

  public static RawToken of(String value) {
    return value == null || value.isBlank() ? EMPTY : new RawToken(value);
  }

  public boolean isPresent() {
    return value != null && !value.isBlank();
  }

  @Override
  public String toString() {
    return "RawToken[REDACTED]";
  }
}
