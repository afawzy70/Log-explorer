package com.logexplorer.core.mapping;

/**
 * A {@link JsonPath} string that does not conform to the supported syntax
 * (mission §21: "Invalid paths must fail safely"). Never thrown mid-search —
 * paths are validated when a profile is saved/validated, not per-event, so
 * an invalid path can never surface as a search-time 500.
 */
public class InvalidJsonPathException extends RuntimeException {
  public InvalidJsonPathException(String message) {
    super(message);
  }
}
