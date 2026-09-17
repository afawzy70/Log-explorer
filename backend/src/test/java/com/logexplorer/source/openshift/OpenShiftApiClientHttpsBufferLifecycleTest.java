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
   * SECONDARY HARDENING EVIDENCE, NOT THE PROVEN REAL ROOT CAUSE (see
   * OPENSHIFT_REAL_ROOT_CAUSE_RECONCILIATION - the proven real-cluster
   * root cause was an oversized JSON response exceeding Spring's default
   * 256 KiB codec limit; see {@code MAX_JSON_RESPONSE_BYTES}). Kept as
   * regression coverage for a genuine, independently-real Reactor
   * characteristic found while investigating: an aggressive, artificial
   * external cancellation (this test's short {@code .timeout(200ms)} -
   * NOT anything production code itself does after the redundant {@code
   * .timeout(TIMEOUT)} was removed from {@code #get}) racing a
   * still-streaming response can trigger Reactor Netty's own internal
   * {@code FluxRetryWhen} machinery, producing an {@code
   * Operators.onErrorDropped} {@code IllegalStateException("...already
   * released due to cancellation.")} log line - the same exception
   * family as the reported {@code IllegalReferenceCountException} ({@code
   * IllegalReferenceCountException}/{@code DataBufferLimitException} both
   * extend {@link IllegalStateException}), which is why this was
   * originally (incorrectly) suspected as THE cause.
   *
   * <p><b>Re-tested this session, with the proven codec fix in place</b>:
   * this dropped-signal log line still appears occasionally (observed in
   * both pooled {@code HttpClient.create()} and non-pooled {@code
   * HttpClient.newConnection()} configurations, at a similar rate) - but
   * critically, in every run, across dozens of repetitions, the
   * subsequent, real request this test asserts on always succeeds
   * correctly. This is Reactor's own safe, spec-compliant handling of a
   * stray/duplicate terminal signal (see {@code Operators.onErrorDropped}'s
   * own contract), not an application-visible corruption - the assertion
   * below has never failed. It is retained as a documented, known,
   * harmless Reactor characteristic, not as evidence of an unfixed bug.
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

  // ------------------------------------------ RECONCILIATION: proven real-cluster codec-limit root cause

  /**
   * OLD_DEFAULT_LIMIT_REPRODUCED=YES - proves the actual bug, not just the
   * fix. A plain {@link org.springframework.web.reactive.function.client.WebClient}
   * with NO custom {@link org.springframework.web.reactive.function.client.ExchangeStrategies}
   * (Spring WebFlux's own default {@code maxInMemorySize}, 256 KiB) fails
   * against the exact same body shape a real corporate cluster's {@code
   * GET /apis/project.openshift.io/v1/projects} produced (~342,197 bytes
   * observed real-world; this mock's {@code VERY_LARGE_PROJECTS_LIST} is
   * ~800 KB, comfortably over the 256 KiB default). Deliberately bypasses
   * {@link OpenShiftApiClient} entirely - this test is NOT about this
   * client's own configuration, it is the independent, falsifiable proof
   * that the OLD (pre-reconciliation) configuration genuinely would have
   * failed this exact way.
   */
  @Test
  void oldDefaultTwoFiftySixKibCodecLimitReproducesTheRealFailure() throws Exception {
    server.setScenario(MockOpenShiftServer.Scenario.VERY_LARGE_PROJECTS_LIST);
    io.netty.handler.ssl.SslContext testSslContext = io.netty.handler.ssl.SslContextBuilder.forClient()
        .trustManager(loadCaAsTrustManager(caPath))
        .build();
    org.springframework.web.reactive.function.client.WebClient plainDefaultClient =
        org.springframework.web.reactive.function.client.WebClient.builder()
            .baseUrl(base.toString())
            .clientConnector(new org.springframework.http.client.reactive.ReactorClientHttpConnector(
                reactor.netty.http.client.HttpClient.create().secure(spec -> spec.sslContext(testSslContext))))
            .build();

    Throwable thrown = org.assertj.core.api.Assertions.catchThrowable(() -> plainDefaultClient
        .get().uri("/apis/project.openshift.io/v1/projects")
        .header("Authorization", "Bearer " + TOKEN.value())
        .retrieve()
        .bodyToMono(com.fasterxml.jackson.databind.JsonNode.class)
        .block());

    assertThat(thrown).isNotNull();
    // DataBufferLimitException extends IllegalStateException; walk the
    // cause chain the same bounded way OpenShiftApiClient#classify does,
    // since Spring may wrap it.
    boolean foundLimitException = false;
    Throwable current = thrown;
    for (int i = 0; current != null && i < 10; i++, current = current.getCause()) {
      if (current instanceof org.springframework.core.io.buffer.DataBufferLimitException) {
        foundLimitException = true;
        break;
      }
    }
    assertThat(foundLimitException)
        .as("the OLD, unconfigured 256 KiB default must genuinely fail on an ~800KB response - "
            + "actual exception chain: %s", thrown)
        .isTrue();
  }

  /** The production fix: the SAME oversized body succeeds through the real, reconciled {@link OpenShiftApiClient}. */
  @Test
  void veryLargeProjectsListOverRealTlsSucceedsWithTheBoundedCodecLimit() {
    server.setScenario(MockOpenShiftServer.Scenario.VERY_LARGE_PROJECTS_LIST);

    ProjectDiscovery discovery = client.fetchProjects(base, TOKEN, caPath).block();

    assertThat(discovery).isNotNull();
    assertThat(discovery.projects()).hasSize(9000);
  }

  /**
   * ABOVE_NEW_LIMIT_TEST - the bound is real, not silently unlimited: a
   * response larger than {@code OpenShiftApiClient}'s own 16 MiB
   * configured limit must fail SAFELY, with the honest, specific message -
   * never hang, never OOM, never fall back to the generic/misleading
   * "unexpected response (HTTP 200)" wording.
   */
  @Test
  void aResponseLargerThanTheConfiguredJsonLimitFailsSafelyWithAnHonestMessage() {
    server.setScenario(MockOpenShiftServer.Scenario.OVER_CONFIGURED_JSON_LIMIT);

    OpenShiftApiException e = org.assertj.core.api.Assertions.catchThrowableOfType(
        () -> client.fetchProjects(base, TOKEN, caPath).block(), OpenShiftApiException.class);

    assertThat(e).isNotNull();
    assertThat(e.kind()).isEqualTo(OpenShiftApiException.Kind.MALFORMED_RESPONSE);
    assertThat(e.getMessage())
        .contains("larger than Log Explorer's configured buffer limit")
        .doesNotContain("unexpected response")
        .doesNotContain("HTTP 200");
  }

  private static javax.net.ssl.X509TrustManager loadCaAsTrustManager(String caPemPath) throws Exception {
    java.security.cert.X509Certificate cert;
    try (var in = java.nio.file.Files.newInputStream(java.nio.file.Path.of(caPemPath))) {
      cert = (java.security.cert.X509Certificate)
          java.security.cert.CertificateFactory.getInstance("X.509").generateCertificate(in);
    }
    java.security.KeyStore keyStore = java.security.KeyStore.getInstance(java.security.KeyStore.getDefaultType());
    keyStore.load(null, null);
    keyStore.setCertificateEntry("test-ca", cert);
    javax.net.ssl.TrustManagerFactory tmf =
        javax.net.ssl.TrustManagerFactory.getInstance(javax.net.ssl.TrustManagerFactory.getDefaultAlgorithm());
    tmf.init(keyStore);
    for (var tm : tmf.getTrustManagers()) {
      if (tm instanceof javax.net.ssl.X509TrustManager x509) {
        return x509;
      }
    }
    throw new IllegalStateException("no X509TrustManager found");
  }
}
