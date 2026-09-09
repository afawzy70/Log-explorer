package com.logexplorer.api;

import com.logexplorer.api.dto.DockerConnectionCandidateDto;
import com.logexplorer.api.dto.DockerConnectionSummaryDto;
import com.logexplorer.config.DockerProperties;
import com.logexplorer.core.model.SourceHealth;
import com.logexplorer.source.docker.DockerClientFactory;
import com.logexplorer.source.docker.DockerDiagnostics;
import com.logexplorer.source.docker.ReadOnlyDockerClient;
import jakarta.validation.Valid;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * Docker connection settings — read-only inspection plus Test Connection
 * (Legacy Remediation Slice 3, {@code
 * docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md} §"Slice 3").
 *
 * <p><b>Owner decision — runtime settings model.</b> This application has
 * no authenticated admin boundary (no Spring Security, no {@code
 * @PreAuthorize}, nothing gating any endpoint by identity — confirmed by
 * inspection before this controller was written). Per the mission's own
 * explicit instruction ("If this application currently has NO
 * authenticated admin boundary, do NOT create an unauthenticated global
 * configuration mutation endpoint that any user can use to redirect the
 * backend to arbitrary Docker hosts"), this controller therefore exposes
 * exactly two capabilities and nothing more:
 * <ul>
 *   <li>{@link #connection()} — the current effective configuration, sanitized, read-only.</li>
 *   <li>{@link #testConnection(DockerConnectionCandidateDto)} — an ephemeral,
 *       never-persisted candidate connection, checked with the exact same
 *       security path as real runtime Docker ({@link DockerClientFactory},
 *       which internally applies {@code source.docker.security.RemoteHostGuard}
 *       for REMOTE mode) and immediately discarded.</li>
 * </ul>
 * There is no endpoint that mutates {@link DockerProperties} — committed
 * runtime configuration remains environment/config-file driven, applied
 * only via a real deployment change and restart. This is not a missing
 * feature; it is a deliberate security boundary given the current
 * authentication posture, documented honestly rather than worked around
 * with an invented pseudo-auth mechanism.
 */
@RestController
@RequestMapping("/api/v1/sources/docker")
public class DockerSettingsController {

  /** Test Connection is always bounded this tightly, regardless of the candidate's own values - a UI action must never hang. */
  private static final Duration TEST_CONNECTION_TIMEOUT = Duration.ofSeconds(2);

  private final DockerProperties properties;
  private final DockerClientFactory clientFactory;

  public DockerSettingsController(DockerProperties properties, DockerClientFactory clientFactory) {
    this.properties = properties;
    this.clientFactory = clientFactory;
  }

  @GetMapping("/connection")
  public DockerConnectionSummaryDto connection() {
    boolean remote = properties.getMode() == DockerProperties.Mode.REMOTE;
    return new DockerConnectionSummaryDto(
        properties.getMode().name(),
        remote ? properties.getHost() : null,
        remote ? properties.getPort() : null,
        properties.isTls(),
        blankToNull(properties.getComposeProjectFilter()),
        false,
        "Permanent connection changes require deployment/runtime configuration "
            + "(environment variables or application.yml) and an application restart — "
            + "there is no in-app way to persist a different Docker connection at runtime.");
  }

  /**
   * Ephemeral only: builds a temporary {@link DockerProperties}, connects
   * through {@link DockerClientFactory#create} (the exact same
   * connection-building/security path runtime Docker uses — never a
   * separate, relaxed "test-only" code path), performs the single minimum
   * read-only operation needed to prove connectivity ({@code ping()}), and
   * closes the client immediately. Never touches {@link #properties}, the
   * singleton the running application actually uses.
   */
  @PostMapping("/test-connection")
  public Mono<SourceHealth> testConnection(@Valid @RequestBody DockerConnectionCandidateDto candidate) {
    // Candidate shape validation happens synchronously, outside the
    // reactive pipeline below - a malformed candidate (bad mode, missing
    // host/cert path) is a genuine client request error (400 via
    // GlobalExceptionHandler), never swallowed into a fabricated DOWN
    // "connection" result by the onErrorResume below, which exists only
    // to classify real connectivity failures.
    DockerProperties ephemeral = toEphemeralProperties(candidate);
    return Mono.fromCallable(() -> {
          try (ReadOnlyDockerClient client = clientFactory.create(ephemeral)) {
            client.ping();
            return new SourceHealth(SourceHealth.Status.UP, "Docker daemon reachable", Instant.now());
          }
        })
        .subscribeOn(Schedulers.boundedElastic())
        .timeout(TEST_CONNECTION_TIMEOUT)
        .onErrorResume(e -> Mono.just(DockerDiagnostics.toHealth(e)));
  }

  private DockerProperties toEphemeralProperties(DockerConnectionCandidateDto candidate) {
    DockerProperties.Mode mode;
    try {
      mode = DockerProperties.Mode.valueOf(candidate.mode().trim().toUpperCase(Locale.ROOT));
    } catch (IllegalArgumentException e) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "mode must be LOCAL or REMOTE");
    }

    DockerProperties ephemeral = new DockerProperties();
    ephemeral.setMode(mode);
    // A UI action must always be bounded, regardless of what a candidate's
    // own (currently nonexistent) timeout fields might say. Set slightly
    // below TEST_CONNECTION_TIMEOUT so the real HTTP client's own
    // connect/response timeout is what actually fires in the normal case
    // - the outer Reactor .timeout() below is a backstop, not the primary
    // bound, avoiding a race between the two on every timeout.
    Duration clientTimeout = TEST_CONNECTION_TIMEOUT.minusMillis(500);
    ephemeral.setConnectTimeout(clientTimeout);
    ephemeral.setRequestTimeout(clientTimeout);

    if (mode == DockerProperties.Mode.LOCAL) {
      return ephemeral;
    }

    if (candidate.host() == null || candidate.host().isBlank()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "host is required when mode is REMOTE");
    }
    ephemeral.setHost(candidate.host());
    // Sensible default, prefilled, always overridable - never forced
    // (mirrors DockerProperties' own default and the mission's own "port
    // has sensible default if omitted").
    ephemeral.setPort(candidate.port() != null ? candidate.port() : 2375);
    boolean tls = Boolean.TRUE.equals(candidate.tls());
    ephemeral.setTls(tls);
    if (tls) {
      if (candidate.tlsCertPath() == null || candidate.tlsCertPath().isBlank()) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "tlsCertPath is required when tls is enabled");
      }
      ephemeral.setTlsCertPath(candidate.tlsCertPath());
    }
    return ephemeral;
  }

  private static String blankToNull(String s) {
    return s == null || s.isBlank() ? null : s;
  }
}
