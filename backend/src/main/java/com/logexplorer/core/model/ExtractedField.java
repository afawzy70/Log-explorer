package com.logexplorer.core.model;

/**
 * One value a classification rule's extraction definition produced for one
 * event, at runtime only (never persisted). {@link #value} is the raw,
 * unredacted extraction result — like every other free-text field on
 * {@link CanonicalLogEvent} it is redacted/masked only at the {@code
 * api.EventMapper} boundary, never shown to a browser as-is.
 *
 * <p>{@code ABSENT} means the definition found nothing (never fabricated);
 * {@code INVALID} means something was found but could not be converted to
 * the declared type, or the extraction failed unexpectedly.
 */
public record ExtractedField(String name, String label, String value, Status status, boolean sensitive) {

  public enum Status { PRESENT, ABSENT, INVALID }

  public static ExtractedField absent(String name, String label, boolean sensitive) {
    return new ExtractedField(name, label, null, Status.ABSENT, sensitive);
  }

  public static ExtractedField invalid(String name, String label, boolean sensitive) {
    return new ExtractedField(name, label, null, Status.INVALID, sensitive);
  }
}
