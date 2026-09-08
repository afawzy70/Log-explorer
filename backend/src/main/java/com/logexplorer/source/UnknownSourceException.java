package com.logexplorer.source;

/** No source is registered under the given id. Maps to HTTP 404. */
public class UnknownSourceException extends RuntimeException {

  private final String sourceId;

  public UnknownSourceException(String sourceId) {
    super("Unknown source: " + sourceId);
    this.sourceId = sourceId;
  }

  public String sourceId() {
    return sourceId;
  }
}
