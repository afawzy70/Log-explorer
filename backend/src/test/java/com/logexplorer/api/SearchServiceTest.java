package com.logexplorer.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.config.SearchGuardrailsProperties;
import com.logexplorer.config.SourcesProperties;
import com.logexplorer.core.guard.ConcurrencyGuard;
import com.logexplorer.core.guard.GuardrailViolationException;
import com.logexplorer.core.guard.SearchGuardrails;
import com.logexplorer.core.guard.TooManyConcurrentSearchesException;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.model.SourceCapabilities;
import com.logexplorer.core.search.PageCursorCodec;
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
    return new SearchService(registry, guardrails, concurrencyGuard, new PageCursorCodec(new ObjectMapper()));
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

  @Test
  void rawLogQlIsRejectedForASourceWhoseCapabilitiesDoNotAllowIt() {
    // stub's default capabilities have rawLogQL=false, matching Docker/
    // fixture's honest reporting (IMPLEMENTATION_PLAN.md "Phase E" scope
    // item 8: "never advertised for Docker").
    SearchRequest request = baseRequest().rawLogQl("{namespace=\"x\"}").build();
    StepVerifier.create(newService().search(request))
        .expectErrorSatisfies(e -> {
          assertThat(e).isInstanceOf(GuardrailViolationException.class);
          assertThat(((GuardrailViolationException) e).reason())
              .isEqualTo(GuardrailViolationException.Reason.RAW_LOGQL_NOT_SUPPORTED);
        })
        .verify(Duration.ofSeconds(2));
  }

  @Test
  void rawLogQlIsAllowedForASourceThatAdvertisesTheCapability() {
    StubLogSource lokiLike = new StubLogSource(
        "openshift-loki", "OpenShift Loki", new SourceCapabilities(true, false, true, false, false, false, false));
    lokiLike.withSearchFlux(Flux.fromIterable(events(1)));
    SearchGuardrails guardrails = new SearchGuardrails(properties);
    ConcurrencyGuard concurrencyGuard = new ConcurrencyGuard(properties);
    LogSourceRegistry registry = new LogSourceRegistry(List.of(lokiLike), new SourcesProperties());
    SearchService service = new SearchService(registry, guardrails, concurrencyGuard, new PageCursorCodec(new ObjectMapper()));

    SearchRequest request = SearchRequest.builder()
        .sourceId("openshift-loki").start(NOW.minusSeconds(60)).end(NOW)
        .rawLogQl("{namespace=\"x\"}")
        .build();

    StepVerifier.create(service.search(request))
        .assertNext(result -> assertThat(result.events()).hasSize(1))
        .verifyComplete();
  }

  @Test
  void aBlankRawLogQlIsNeverTreatedAsARequestForTheCapability() {
    // An empty string must not spuriously trip the gate - only a real
    // non-blank value counts as "raw LogQL requested".
    SearchRequest request = baseRequest().rawLogQl("").build();
    StepVerifier.create(newService().search(request))
        .expectNextCount(1)
        .verifyComplete();
  }

  // ------------------------------------------------------------ OS-1C review recovery: runtime completeness metadata

  @Test
  void aSourceReportedRuntimeWarningMarksTheResultTruncatedAndAppendsItToQueryPlanNotes() {
    stub.withSearchFlux(Flux.fromIterable(events(2)))
        .withRuntimeWarnings(List.of("1 of 2 pod/container targets could not be found (TARGET_NOT_FOUND)."));

    StepVerifier.create(newService().search(baseRequest().build()))
        .assertNext(result -> {
          assertThat(result.events()).hasSize(2); // the successful target's own events are still returned
          assertThat(result.counts().truncated()).isTrue();
          assertThat(result.counts().estimatedTotal()).isNull(); // never an exact total when incomplete
          assertThat(result.queryPlan().notes())
              .anySatisfy(note -> assertThat(note).contains("TARGET_NOT_FOUND"));
        })
        .verifyComplete();
  }

  @Test
  void noRuntimeWarningsLeavesResultsExactlyAsBeforeThisRecovery() {
    stub.withSearchFlux(Flux.fromIterable(events(2))); // no .withRuntimeWarnings() - the default, empty

    StepVerifier.create(newService().search(baseRequest().build()))
        .assertNext(result -> {
          assertThat(result.counts().truncated()).isFalse();
          assertThat(result.counts().estimatedTotal()).isEqualTo(2);
        })
        .verifyComplete();
  }

  @Test
  void preSearchScopeWarningsAndRuntimeWarningsCoexistInTheSameNotesList() {
    // OS-1C review recovery mission §5/§10 - "scope PARTIAL + runtime
    // target failure -> both reasons preserved," never one silently
    // replacing the other.
    stub.withSearchFlux(Flux.fromIterable(events(1)))
        .withScopeWarnings(List.of("Pod scope may be incomplete (SCOPE_PARTIAL)."))
        .withRuntimeWarnings(List.of("1 of 3 pod/container targets timed out (TARGET_TIMEOUT)."));

    StepVerifier.create(newService().search(baseRequest().build()))
        .assertNext(result -> {
          assertThat(result.queryPlan().notes())
              .anySatisfy(note -> assertThat(note).contains("SCOPE_PARTIAL"))
              .anySatisfy(note -> assertThat(note).contains("TARGET_TIMEOUT"));
          assertThat(result.counts().truncated()).isTrue();
        })
        .verifyComplete();
  }

  @Test
  void overlappingConcurrentSearchesOnDifferentSourcesNeverLeakOneSourcesRuntimeWarningsIntoTheOthers() {
    // OS-1C review recovery mission §4/§10 - runtime metadata must belong
    // to the exact search invocation, never a shared/mutable side channel.
    // Proven here the same way a real leak would actually show up: two
    // genuinely concurrent searches (Mono.zip subscribes to both before
    // either necessarily completes), each against its own source with its
    // own distinct warning text, asserting neither result ever contains
    // the other's warning.
    StubLogSource sourceA = new StubLogSource("source-a")
        .withSearchFlux(Flux.fromIterable(events(1)))
        .withRuntimeWarnings(List.of("SOURCE-A-ONLY-WARNING (TARGET_NOT_FOUND)."));
    StubLogSource sourceB = new StubLogSource("source-b")
        .withSearchFlux(Flux.fromIterable(events(1)))
        .withRuntimeWarnings(List.of("SOURCE-B-ONLY-WARNING (PERMISSION_DENIED)."));

    SearchGuardrails guardrails = new SearchGuardrails(properties);
    ConcurrencyGuard concurrencyGuard = new ConcurrencyGuard(properties);
    LogSourceRegistry registry = new LogSourceRegistry(List.of(sourceA, sourceB), new SourcesProperties());
    SearchService service =
        new SearchService(registry, guardrails, concurrencyGuard, new PageCursorCodec(new ObjectMapper()));

    SearchRequest requestA = SearchRequest.builder().sourceId("source-a").start(NOW.minusSeconds(60)).end(NOW).build();
    SearchRequest requestB = SearchRequest.builder().sourceId("source-b").start(NOW.minusSeconds(60)).end(NOW).build();

    reactor.core.publisher.Mono<com.logexplorer.core.model.SearchResult[]> both =
        reactor.core.publisher.Mono.zip(service.search(requestA), service.search(requestB))
            .map(tuple -> new com.logexplorer.core.model.SearchResult[] {tuple.getT1(), tuple.getT2()});

    StepVerifier.create(both)
        .assertNext(results -> {
          List<String> notesA = results[0].queryPlan().notes();
          List<String> notesB = results[1].queryPlan().notes();
          assertThat(notesA).anySatisfy(n -> assertThat(n).contains("SOURCE-A-ONLY-WARNING"));
          assertThat(notesA).noneSatisfy(n -> assertThat(n).contains("SOURCE-B-ONLY-WARNING"));
          assertThat(notesB).anySatisfy(n -> assertThat(n).contains("SOURCE-B-ONLY-WARNING"));
          assertThat(notesB).noneSatisfy(n -> assertThat(n).contains("SOURCE-A-ONLY-WARNING"));
        })
        .verifyComplete();
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
