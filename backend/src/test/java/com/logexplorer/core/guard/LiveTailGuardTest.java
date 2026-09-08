package com.logexplorer.core.guard;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.config.LiveTailProperties;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;
import reactor.test.StepVerifier;

class LiveTailGuardTest {

  @Test
  void rejectsBeyondTheConfiguredCapAndReleasesOnCancellation() {
    LiveTailProperties properties = new LiveTailProperties();
    properties.setMaxConcurrentTails(1);
    LiveTailGuard guard = new LiveTailGuard(properties);

    Disposable holder = guard.guard(Flux.never()).subscribe();
    assertThat(guard.availablePermits()).isEqualTo(0);

    StepVerifier.create(guard.guard(Flux.just("x")))
        .expectError(TooManyConcurrentLiveTailsException.class)
        .verify(Duration.ofSeconds(2));

    holder.dispose(); // client disconnects, exactly like an EventSource being closed
    assertThat(guard.availablePermits()).isEqualTo(1);

    StepVerifier.create(guard.guard(Flux.just("y")))
        .expectNext("y")
        .verifyComplete();
  }

  @Test
  void allowsUpToTheConfiguredCapConcurrently() {
    LiveTailProperties properties = new LiveTailProperties();
    properties.setMaxConcurrentTails(2);
    LiveTailGuard guard = new LiveTailGuard(properties);

    Disposable d1 = guard.guard(Flux.never()).subscribe();
    Disposable d2 = guard.guard(Flux.never()).subscribe();
    assertThat(guard.availablePermits()).isEqualTo(0);

    StepVerifier.create(guard.guard(Flux.just("over-cap")))
        .expectError(TooManyConcurrentLiveTailsException.class)
        .verify(Duration.ofSeconds(2));

    d1.dispose();
    d2.dispose();
    assertThat(guard.availablePermits()).isEqualTo(2);
  }
}
