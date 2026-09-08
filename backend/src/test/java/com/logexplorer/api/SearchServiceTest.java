package com.logexplorer.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.config.SearchGuardrailsProperties;
import com.logexplorer.config.SourcesProperties;
import com.logexplorer.core.guard.ConcurrencyGuard;
import com.logexplorer.core.guard.GuardrailViolationException;
import com.logexplorer.core.guard.SearchGuardrails;
import com.logexplorer.core.guard.TooManyConcurrentSearchesException;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.source.LogSourceRegistry;
import com.logexplorer.source.StubLogSource;
import com.logexplorer.source.UnknownSourceException;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.TimeoutException;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import reactor.core.Disposable;
import reactor.core.publisher.Flux;
import reactor.test.StepVerifier;

class SearchServiceTest {

  private static final Instant NOW = Instant.parse("2026-01-01T12:00:00Z");

  private SearchGuardrailsProperties properties = new SearchGuardrailsProperties();
  private StubLogSource stub = new StubLogSource("local-docker");

  private SearchService newService() {
    SearchGuardrails guardrails = new SearchGuardrails(properties);
    ConcurrencyGuard concurrencyGuard = new ConcurrencyGuard(properties);
    LogSourceRegistry registry = new LogSourceRegistry(List.of(stub), new SourcesProperties());
    return new SearchService(registry, guardrails, concurrencyGuard);
  }

  private SearchRequest.Builder baseRequest() {
    return SearchRequest.builder().sourceId("local-docker").start(NOW.minusSeconds(60)).end(NOW);
  }

  @Test
  void unknownSourcePropagatesAsAnErrorSignalNotAThrownException() {
    SearchRequest request = SearchRequest.builder().sourceId("missing").start(NOW.minusSeconds(60)).end(NOW).build();
    StepVerifier.create(newService().search(request))
        .expectError(UnknownSourceException.class)
        .verify(Duration.ofSeconds(2));
  }

  @Test
  void guardrailViolationPropagatesAsAnErrorSignal() {
    SearchRequest request = baseRequest().start(NOW).end(NOW.minusSeconds(60)).build(); // start after end
    StepVerifier.create(newService().search(request))
        .expectError(GuardrailViolationException.class)
        .verify(Duration.ofSeconds(2));
  }

  @Test
  void truncationFlagIsSetWhenTheSourceHasMoreThanTheEffectiveLimit() {
    properties.setDefaultLimit(3);
    stub.withSearchFlux(Flux.fromIterable(events(10)));

    StepVerifier.create(newService().search(baseRequest().build()))
        .assertNext(result -> {
          assertThat(result.events()).hasSize(3);
          assertThat(result.counts().returned()).isEqualTo(3);
          assertThat(result.counts().limit()).isEqualTo(3);
          assertThat(result.counts().truncated()).isTrue();
        })
        .verifyComplete();
  }

  @Test
  void truncationFlagIsFalseWhenResultCountIsExactlyAtTheLimit() {
    properties.setDefaultLimit(5);
    stub.withSearchFlux(Flux.fromIterable(events(5)));

    StepVerifier.create(newService().search(baseRequest().build()))
        .assertNext(result -> {
          assertThat(result.events()).hasSize(5);
          assertThat(result.counts().truncated()).isFalse();
        })
        .verifyComplete();
  }

  @Test
  void truncationFlagIsFalseWhenResultCountIsBelowTheLimit() {
    properties.setDefaultLimit(50);
    stub.withSearchFlux(Flux.fromIterable(events(2)));

    StepVerifier.create(newService().search(baseRequest().build()))
        .assertNext(result -> {
          assertThat(result.events()).hasSize(2);
          assertThat(result.counts().truncated()).isFalse();
        })
        .verifyComplete();
  }

  @Test
  void cancellationPropagatesDownToTheUnderlyingSource() {
    stub.withSearchFlux(Flux.never());
    Disposable subscription = newService().search(baseRequest().build()).subscribe();

    subscription.dispose();

    assertThat(stub.cancelled.get()).isTrue();
  }

  @Test
  void requestTimesOutWhenTheSourceNeverCompletes() {
    properties.setRequestTimeout(Duration.ofMillis(100));
    stub.withSearchFlux(Flux.never());

    StepVerifier.create(newService().search(baseRequest().build()))
        .expectError(TimeoutException.class)
        .verify(Duration.ofSeconds(2));
  }

  @Test
  void concurrencyCapIsEnforcedAcrossSearchesOnTheSameSource() {
    properties.setMaxConcurrency(1);
    stub.withSearchFlux(Flux.never());
    SearchService service = newService();

    Disposable holder = service.search(baseRequest().build()).subscribe();
    try {
      StepVerifier.create(service.search(baseRequest().build()))
          .expectError(TooManyConcurrentSearchesException.class)
          .verify(Duration.ofSeconds(2));
    } finally {
      holder.dispose();
    }
  }

  private List<CanonicalLogEvent> events(int count) {
    return IntStream.range(0, count)
        .mapToObj(i -> CanonicalLogEvent.builder()
            .timestamp(NOW.minusSeconds(count - i))
            .message("event " + i)
            .service("gateway")
            .build())
        .toList();
  }
}
