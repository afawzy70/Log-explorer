package com.logexplorer.core.guard;

import com.logexplorer.config.SearchGuardrailsProperties;
import java.util.concurrent.Semaphore;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Flux;

/**
 * Bounds the number of concurrently-executing searches
 * (IMPLEMENTATION_PLAN.md "Phase B" item 10: "bounded concurrency"). A
 * non-blocking {@link Semaphore#tryAcquire()} at subscription time — never
 * blocks a WebFlux event-loop thread. The permit is released on every
 * terminal signal (complete, error, or cancel), so a client that
 * disconnects mid-search still frees its slot.
 */
@Component
public class ConcurrencyGuard {

  private final Semaphore semaphore;

  public ConcurrencyGuard(SearchGuardrailsProperties properties) {
    this.semaphore = new Semaphore(properties.getMaxConcurrency());
  }

  public <T> Flux<T> guard(Flux<T> source) {
    return Flux.defer(() -> {
      if (!semaphore.tryAcquire()) {
        return Flux.error(new TooManyConcurrentSearchesException());
      }
      return source.doFinally(signal -> semaphore.release());
    });
  }

  /** Permits currently available — exposed for tests, not part of the public contract otherwise. */
  public int availablePermits() {
    return semaphore.availablePermits();
  }
}
