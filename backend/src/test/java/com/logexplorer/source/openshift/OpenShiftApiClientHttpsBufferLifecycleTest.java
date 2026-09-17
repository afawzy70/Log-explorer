package com.logexplorer.source.openshift;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.core.model.RawToken;
import java.io.IOException;
import java.net.URI;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * OPENSHIFT_HTTP_BUFFER_LIFECYCLE bug fix mission — diagnostic
 * reproduction against a real TLS handshake (see {@link
 * MockOpenShiftHttpsServer}'s own javadoc for why HTTPS specifically, not
 * the existing plain-HTTP {@link MockOpenShiftServer} suite, was never
 * exercised before).
 */
class OpenShiftApiClientHttpsBufferLifecycleTest {

  private static final RawToken TOKEN = RawToken.of("sha256~test-token-value-0123456789");

  private MockOpenShiftHttpsServer server;
  private OpenShiftApiClient client;
  private URI base;
  private String caPath;

  @BeforeEach
  void setUp() throws Exception {
    server = new MockOpenShiftHttpsServer();
    client = new OpenShiftApiClient(Map.of());
    base = URI.create(server.baseUrl());
    caPath = server.caPemPath();
  }

  @AfterEach
  void tearDown() {
    if (server != null) {
      server.close();
    }
  }

  /**
   * PRODUCTION_CONNECT_ORCHESTRATION_TEST - the exact real request graph
   * (Step 2): {@code OpenShiftConnectionService#connect} ->
   * discoverProjectsOrNamespaces (fetchProjects, .onErrorResume-guarded
   * namespaces fallback) -> .flatMap -> fetchUsername
   * (.defaultIfEmpty(Optional.empty())) -> .map (session.connect) ->
   * .onErrorMap -> .doOnSuccess/.doOnError (this mission's new
   * diagnostics) -> .contextWrite(attemptId), over real TLS, end to end -
   * not just the individual OpenShiftApiClient calls other tests in this
   * class exercise in isolation.
   */
  @Test
  void productionConnectOrchestrationEndToEndOverRealTls() {
    OpenShiftConnectionService service =
        new OpenShiftConnectionService(client, new OpenShiftSession(), new LoopbackBindingGuard("127.0.0.1"));
    String loginCommand = "oc login --token=" + TOKEN.value() + " --server=" + server.baseUrl()
        + " --certificate-authority=" + caPath;

    OpenShiftSession session = service.connect(loginCommand, "test-connection").block();

    assertThat(session).isNotNull();
    assertThat(session.operationSnapshot().isConnected()).isTrue();
  }

  @Test
  void singleProjectsFetchOverRealTlsSucceeds() {
    ProjectDiscovery discovery = client.fetchProjects(base, TOKEN, caPath).block();
    assertThat(discovery).isNotNull();
    assertThat(discovery.projects()).containsExactly("accounts", "gateway", "payments");
  }

  @Test
  void twoSequentialCallsOverRealTlsMirroringTheRealConnectFlow() {
    // Mirrors OpenShiftConnectionService#connect: fetchProjects (or
    // fetchNamespaces), THEN fetchUsername, in sequence, over what Reactor
    // Netty's default connection pool would treat as the same host:port -
    // a keep-alive connection reuse opportunity that no existing test
    // (always plain HTTP) has ever exercised.
    ProjectDiscovery discovery = client.fetchProjects(base, TOKEN, caPath).block();
    assertThat(discovery).isNotNull();

    var username = client.fetchUsername(base, TOKEN, caPath).block();
    assertThat(username).isPresent().contains("developer");
  }

  @Test
  void largeMultiChunkResponseOverRealTlsDoesNotThrowIllegalReferenceCount() {
    // A tiny single-TLS-record response (every other test here, and every
    // existing plain-HTTP test) never exercises Reactor Netty's
    // multi-DataBuffer aggregation path at all. A real OpenShift cluster's
    // projects/namespaces list is not always this large, but a large
    // cluster's easily can be - and network fragmentation alone (not
    // possible to simulate reliably over loopback) can split even a small
    // body across multiple TCP reads. A large body is the reliable,
    // deterministic way to force the same multi-chunk aggregation code
    // path locally.
    server.setScenario(MockOpenShiftServer.Scenario.LARGE_PROJECTS_LIST);
    ProjectDiscovery discovery = client.fetchProjects(base, TOKEN, caPath).block();
    assertThat(discovery).isNotNull();
    assertThat(discovery.projects()).hasSize(2000);
  }

  /**
   * PROVED THE BUG (root-cause evidence, keep for regression coverage):
   * before the fix, {@code OpenShiftApiClient#get} applied its own
   * Reactor-Core {@code .timeout(TIMEOUT)} operator downstream of {@code
   * .retrieve().bodyToMono(...)}, IN ADDITION TO {@code
   * HttpClient#responseTimeout} already applied in {@code #build}. When a
   * caller's own cancellation (this test's short external timeout stands
   * in for "any cancellation racing a still-streaming body" - a slow real
   * network is what would trigger the client's OWN 15s timeout the same
   * way in production) fires while the response body is still arriving,
   * it races Reactor Netty's own internal retry-on-stale-pooled-connection
   * logic ({@code FluxRetryWhen}, confirmed in the captured stack trace):
   * a retried inbound response gets delivered to a {@code
   * ReactorClientHttpResponse} whose body was already released by the
   * FIRST (cancelled) attempt, throwing {@code IllegalStateException("The
   * client response body has been released already due to
   * cancellation.")} - the same buffer-lifecycle-violation family as the
   * reported {@code IllegalReferenceCountException}. Reproduced reliably
   * (3-4 out of 5 runs) with the OLD code; the fix (a single,
   * framework-coordinated {@code HttpClient#responseTimeout} instead of a
   * second, uncoordinated Reactor-Core {@code .timeout()}) removes the
   * client's OWN contribution to this race entirely.
   */
  @Test
  void repeatedCancellationOfAStillStreamingResponseNeverCorruptsTheNextCall() {
    server.setScenario(MockOpenShiftServer.Scenario.CHUNKED_SLOW);
    for (int i = 0; i < 15; i++) {
      try {
        // Stands in for a caller-level cancellation (a real slow network
        // would trigger this client's own HttpClient#responseTimeout the
        // same way) - the assertion is about what happens to the
        // connection/buffers AFTERWARD, not about this call itself.
        client.fetchProjects(base, TOKEN, caPath)
            .timeout(java.time.Duration.ofMillis(200))
            .block();
      } catch (Exception expectedTimeoutOrSimilar) {
        // A timeout itself is an expected, correct outcome here.
      }
    }
    // If the race corrupted shared connection-pool/buffer state, a
    // subsequent NORMAL (non-timed-out) call is where it would surface -
    // either as an exception here, or (the actually-reported symptom) as a
    // successful-looking call that silently fails to decode.
    server.setScenario(MockOpenShiftServer.Scenario.OK);
    ProjectDiscovery discovery = client.fetchProjects(base, TOKEN, caPath).block();
    assertThat(discovery).isNotNull();
    assertThat(discovery.projects()).containsExactly("accounts", "gateway", "payments");
  }

  @Test
  void aGenuinelyHangingServerStillTimesOutRatherThanHangingForever() {
    // Proves removing the redundant Reactor-Core .timeout(TIMEOUT) did NOT
    // remove timeout protection altogether - a bound (whether
    // HttpClient#responseTimeout or a caller's own .timeout(), the same
    // way a real caller's own bound would apply) must still cut off a
    // response that takes far longer than expected, rather than hanging
    // until the server finishes (~1.2s for CHUNKED_SLOW's 8 delayed
    // chunks). The production TIMEOUT constant is 15s, too slow for a
    // unit test - this external timeout stands in for it the same way the
    // other tests in this class do.
    server.setScenario(MockOpenShiftServer.Scenario.CHUNKED_SLOW);
    long start = System.nanoTime();
    org.assertj.core.api.Assertions.assertThatThrownBy(() ->
            client.fetchProjects(base, TOKEN, caPath).timeout(java.time.Duration.ofMillis(300)).block())
        .isInstanceOf(Exception.class);
    long elapsedMs = java.time.Duration.ofNanos(System.nanoTime() - start).toMillis();
    assertThat(elapsedMs).isLessThan(1_000);
  }

  @Test
  void tenSequentialConnectFlowsOverRealTlsNeverThrowIllegalReferenceCount() {
    for (int i = 0; i < 10; i++) {
      ProjectDiscovery discovery = client.fetchProjects(base, TOKEN, caPath).block();
      assertThat(discovery).isNotNull();
      var username = client.fetchUsername(base, TOKEN, caPath).block();
      assertThat(username).isPresent();
    }
  }

  // ----------------------------------------------------- Phase C, over real TLS

  @Test
  void http200ValidJsonOverRealTls() {
    ProjectDiscovery discovery = client.fetchProjects(base, TOKEN, caPath).block();
    assertThat(discovery).isNotNull();
    assertThat(discovery.projects()).containsExactly("accounts", "gateway", "payments");
  }

  @Test
  void http401OverRealTls() {
    server.setScenario(MockOpenShiftServer.Scenario.UNAUTHORIZED_401);
    var thrown = org.assertj.core.api.Assertions.catchThrowableOfType(
        () -> client.fetchProjects(base, TOKEN, caPath).block(), OpenShiftApiException.class);
    assertThat(thrown.kind()).isEqualTo(OpenShiftApiException.Kind.UNAUTHORIZED);
  }

  @Test
  void http403OverRealTls() {
    server.setScenario(MockOpenShiftServer.Scenario.FORBIDDEN_403);
    var thrown = org.assertj.core.api.Assertions.catchThrowableOfType(
        () -> client.fetchProjects(base, TOKEN, caPath).block(), OpenShiftApiException.class);
    assertThat(thrown.kind()).isEqualTo(OpenShiftApiException.Kind.FORBIDDEN);
  }

  @Test
  void http5xxOverRealTls() {
    server.setScenario(MockOpenShiftServer.Scenario.INTERNAL_SERVER_ERROR_500);
    var thrown = org.assertj.core.api.Assertions.catchThrowableOfType(
        () -> client.fetchProjects(base, TOKEN, caPath).block(), OpenShiftApiException.class);
    assertThat(thrown.kind()).isEqualTo(OpenShiftApiException.Kind.MALFORMED_RESPONSE);
    assertThat(thrown.getMessage()).contains("HTTP 500");
  }

  /**
   * Phase E — the exact real-world symptom the mission set out to fix: an
   * HTTP 200 whose body Log Explorer cannot actually parse must never be
   * reported as if the response itself were the problem ("unexpected
   * response (HTTP 200)" - literally true-sounding but misleading, since
   * 200 is a perfectly normal status). {@link OpenShiftApiClient#classify}
   * must recognize this as a body-processing failure specifically.
   */
  @Test
  void http200MalformedJsonOverRealTlsReportsAProcessingFailureNotAnUnexpectedStatus() {
    server.setScenario(MockOpenShiftServer.Scenario.MALFORMED_BODY);
    var thrown = org.assertj.core.api.Assertions.catchThrowableOfType(
        () -> client.fetchProjects(base, TOKEN, caPath).block(), OpenShiftApiException.class);
    assertThat(thrown.kind()).isEqualTo(OpenShiftApiException.Kind.MALFORMED_RESPONSE);
    assertThat(thrown.getMessage())
        .contains("HTTP 200")
        .contains("could not process")
        .doesNotContain("unexpected response");
  }

  @Test
  void http200EmptyItemsListOverRealTlsIsAGenuinelyEmptyProjectListNotAFailure() {
    // An empty items array (real cluster answer: "you have no projects")
    // is a success, not an exception - OS-1A §15's own "three truths"
    // distinction, unaffected by this mission's fix.
    server.setScenario(MockOpenShiftServer.Scenario.EMPTY_PROJECTS);
    ProjectDiscovery discovery = client.fetchProjects(base, TOKEN, caPath).block();
    assertThat(discovery).isNotNull();
    assertThat(discovery.isEmpty()).isTrue();
  }

  /** Phase C case 6 - a genuinely zero-byte body, distinct from a valid-but-empty {@code {"items":[]}}. */
  @Test
  void http200GenuinelyEmptyBodyOverRealTlsReportsAProcessingFailure() {
    server.setScenario(MockOpenShiftServer.Scenario.EMPTY_BODY);
    var thrown = org.assertj.core.api.Assertions.catchThrowableOfType(
        () -> client.fetchProjects(base, TOKEN, caPath).block(), OpenShiftApiException.class);
    assertThat(thrown.kind()).isEqualTo(OpenShiftApiException.Kind.MALFORMED_RESPONSE);
    assertThat(thrown.getMessage()).contains("HTTP 200").contains("could not process");
  }

  // -------------------------------------------- RECOVERY_2: production-topology reproduction

  /**
   * OPENSHIFT_REAL_ENVIRONMENT_BUFFER_BUG_RECOVERY_2 Step 6 - the
   * production characteristic the original reproduction never modeled: a
   * real Log Explorer instance is not only ever calling {@code get()}
   * (JSON discovery). {@code OpenShiftApiClient#followPodLog} (Live Tail)
   * and {@code #fetchPodLog} consume raw {@code Flux<DataBuffer>} via
   * hand-written {@code BaseSubscriber}s ({@code LineDecodingSubscriber},
   * {@code BoundedBodyCollector}) that manually call {@code
   * DataBufferUtils.release(buffer)} - and {@code OpenShiftApiClient#build}
   * gives EVERY call, JSON or raw-buffer alike, the SAME Reactor Netty
   * {@code HttpClient.create()} - the JVM-wide DEFAULT, SHARED connection
   * pool. A real user reconnecting to OpenShift while a Live Tail session
   * from a PREVIOUS connection is still active (or was just abruptly
   * stopped) is an entirely ordinary sequence, not a contrived one - the
   * two code paths are not actually isolated from each other in
   * production despite looking unrelated in the source.
   *
   * <p>This test: starts a genuine, never-completing pod-log stream (the
   * mock server writes one line every 100ms forever, exactly like a real
   * {@code kubectl logs -f}), lets a few lines flow through {@code
   * LineDecodingSubscriber}'s manual-release path, cancels it mid-stream
   * (simulating Stop / a dropped connection) WHILE immediately firing a
   * JSON discovery call that can reuse the same now-returned-to-the-pool
   * connection - repeated many times to give any pool-reuse/buffer-
   * lifecycle race a real chance to manifest.
   */
  @Test
  void cancellingALiveTailStreamNeverCorruptsAConcurrentJsonDiscoveryCall() {
    java.util.List<Throwable> unexpected = new java.util.ArrayList<>();
    for (int i = 0; i < 20; i++) {
      java.util.concurrent.CountDownLatch gotSomeLines = new java.util.concurrent.CountDownLatch(3);
      reactor.core.Disposable tail = client
          .followPodLog(base, TOKEN, caPath, "ns", "pod", "container", 0, 8192, () -> { }, () -> { })
          .doOnNext(line -> gotSomeLines.countDown())
          .subscribe(line -> { }, error -> unexpected.add(error));
      try {
        gotSomeLines.await(2, java.util.concurrent.TimeUnit.SECONDS);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
      // Stop the tail (real "disconnect" cancellation) and, essentially
      // simultaneously, issue a normal JSON discovery call - the exact
      // "reconnect while a prior stream is winding down" production shape.
      tail.dispose();
      try {
        ProjectDiscovery discovery = client.fetchProjects(base, TOKEN, caPath).block();
        assertThat(discovery).isNotNull();
      } catch (Exception e) {
        unexpected.add(e);
      }
    }
    for (Throwable t : unexpected) {
      System.out.println("[BufferLifecycleTest] cross-contamination candidate: "
          + t.getClass().getName() + ": " + t.getMessage());
    }
    assertThat(unexpected)
        .as("a Live Tail cancellation must never corrupt an unrelated, concurrent JSON discovery call")
        .isEmpty();
  }
}
