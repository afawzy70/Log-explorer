package com.logexplorer.core.guard;

/** Thrown by {@link LiveTailGuard} when the concurrent-live-tail cap is already exhausted. Maps to HTTP 429. */
public class TooManyConcurrentLiveTailsException extends RuntimeException {

  public TooManyConcurrentLiveTailsException() {
    super("Too many concurrent live tails");
  }
}
