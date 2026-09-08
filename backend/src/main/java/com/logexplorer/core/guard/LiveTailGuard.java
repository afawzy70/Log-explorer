package com.logexplorer.core.guard;

import com.logexplorer.config.LiveTailProperties;
import java.util.concurrent.Semaphore;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Flux;

/**
 * Bounds the number of concurrently-open live tails (IMPLEMENTATION_PLAN.md
 * "Phase J": "max concurrent tails"). A non-blocking {@link
 * Semaphore#tryAcquire()} at subscription time — never blocks a WebFlux
 * event-loop thread. The permit is released on every terminal signal
 * (complete, error, or cancel — {@code doFinally}), so a client that
 * disconnects mid-tail still frees its slot; mirrors {@link
 * ConcurrencyGuard}'s own documented contract, kept as its own class
 * since search and live-tail concurrency are conceptually different
 * resources (short-lived requests vs. long-lived streaming connections)
 * with independently configured limits.
 */
@Component
public class LiveTailGuard {

  private final Semaphore semaphore;

  public LiveTailGuard(LiveTailProperties properties) {
    this.semaphore = new Semaphore(properties.getMaxConcurrentTails());
  }

  public <T> Flux<T> guard(Flux<T> source) {
    return Flux.defer(() -> {
      if (!semaphore.tryAcquire()) {
        return Flux.error(new TooManyConcurrentLiveTailsException());
      }
      return source.doFinally(signal -> semaphore.release());
    });
  }

  /** Permits currently available — exposed for tests, not part of the public contract otherwise. */
  public int availablePermits() {
    return semaphore.availablePermits();
  }
}
