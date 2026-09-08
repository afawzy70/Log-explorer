package com.logexplorer.core.guard;

/** The configured concurrent-search cap is already at capacity. Maps to HTTP 429. */
public class TooManyConcurrentSearchesException extends RuntimeException {

  public TooManyConcurrentSearchesException() {
    super("Too many concurrent searches; try again shortly");
  }
}
