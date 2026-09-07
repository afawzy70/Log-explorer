package com.logexplorer.core.guard;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.config.SearchGuardrailsProperties;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Sinks;
import reactor.test.StepVerifier;

class ConcurrencyGuardTest {

  @Test
  void rejectsBeyondTheConfiguredCapAndReleasesOnCompletion() {
    SearchGuardrailsProperties properties = new SearchGuardrailsProperties();
    properties.setMaxConcurrency(1);
    ConcurrencyGuard guard = new ConcurrencyGuard(properties);

    Sinks.Many<String> inFlight = Sinks.many().unicast().onBackpressureBuffer();
    Disposable holder = guard.guard(inFlight.asFlux()).subscribe();

    assertThat(guard.availablePermits()).isEqualTo(0);

    StepVerifier.create(guard.guard(Flux.just("x")))
        .expectError(TooManyConcurrentSearchesException.class)
        .verify(Duration.ofSeconds(2));

    inFlight.tryEmitComplete();
    assertThat(guard.availablePermits()).isEqualTo(1);

    // The permit is genuinely usable again, not just numerically reported as free.
    StepVerifier.create(guard.guard(Flux.just("y")))
        .expectNext("y")
        .verifyComplete();

    holder.dispose();
  }

  @Test
  void releasesOnCancellationNotJustNormalCompletion() {
    SearchGuardrailsProperties properties = new SearchGuardrailsProperties();
    properties.setMaxConcurrency(1);
    ConcurrencyGuard guard = new ConcurrencyGuard(properties);

    Disposable holder = guard.guard(Flux.never()).subscribe();
    assertThat(guard.availablePermits()).isEqualTo(0);

    holder.dispose(); // client disconnects mid-search
    assertThat(guard.availablePermits()).isEqualTo(1);
  }

  @Test
  void allowsUpToTheConfiguredCapConcurrently() {
    SearchGuardrailsProperties properties = new SearchGuardrailsProperties();
    properties.setMaxConcurrency(3);
    ConcurrencyGuard guard = new ConcurrencyGuard(properties);

    Disposable d1 = guard.guard(Flux.never()).subscribe();
    Disposable d2 = guard.guard(Flux.never()).subscribe();
    Disposable d3 = guard.guard(Flux.never()).subscribe();

    assertThat(guard.availablePermits()).isEqualTo(0);

    StepVerifier.create(guard.guard(Flux.just("over-cap")))
        .expectError(TooManyConcurrentSearchesException.class)
        .verify(Duration.ofSeconds(2));

    d1.dispose();
    d2.dispose();
    d3.dispose();
  }
}
