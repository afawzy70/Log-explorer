package com.logexplorer.source;

/** The source exists but is disabled by configuration. Maps to HTTP 400. */
public class DisabledSourceException extends RuntimeException {

  private final String sourceId;

  public DisabledSourceException(String sourceId) {
    super("Source is disabled: " + sourceId);
    this.sourceId = sourceId;
  }

  public String sourceId() {
    return sourceId;
  }
}
