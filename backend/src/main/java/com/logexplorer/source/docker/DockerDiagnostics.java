package com.logexplorer.source.docker;

import com.logexplorer.core.model.SourceHealth;
import com.logexplorer.source.docker.security.RemoteHostRejectedException;
import java.time.Instant;
import java.util.Locale;

/**
 * Maps a Docker connection failure to an actionable, sanitized message
 * (IMPLEMENTATION_PLAN.md "Phase C" scope item 7). Every message here is a
 * fixed string chosen by classification, never the raw exception message —
 * so nothing environment-specific (a path, a hostname fragment from deep
 * in a stack trace) can leak through by accident. None of these ever
 * suggest exposing the Docker daemon over TCP as a fix.
 */
public final class DockerDiagnostics {

  private DockerDiagnostics() {
  }

  public static SourceHealth toHealth(Throwable error) {
    return new SourceHealth(SourceHealth.Status.DOWN, classify(error), Instant.now());
  }

  static String classify(Throwable error) {
    Throwable root = rootCause(error);

    // Legacy Remediation Slice 3 - RemoteHostGuard's own rejection is
    // already a precise, sanitized classification (DNS_FAILURE vs
    // POLICY_REJECTED), never a raw exception message to pattern-match
    // against; checked against both the top-level and root-cause throwable
    // since it is never itself wrapped around another cause.
    RemoteHostRejectedException rejected = error instanceof RemoteHostRejectedException e ? e
        : root instanceof RemoteHostRejectedException e ? e : null;
    if (rejected != null) {
      return switch (rejected.reason()) {
        case DNS_FAILURE -> "Cannot reach the configured Docker host. Confirm the host and port are correct.";
        case POLICY_REJECTED ->
            "The configured Docker host was rejected by connection policy (SSRF protection). If this is a "
                + "legitimate private-network Docker host, add it to the remote host allowlist.";
      };
    }

    String msg = String.valueOf(root.getMessage()).toLowerCase(Locale.ROOT);

    // java.net.UnknownHostException's own message is just the raw hostname
    // (e.g. "bad-host"), not a descriptive phrase - the type itself, not
    // the message text, is what signals a DNS resolution failure here.
    if (root instanceof java.net.UnknownHostException) {
      return "Cannot reach the configured Docker host. Confirm the host and port are correct.";
    }
    if (msg.contains("permission denied")) {
      return "Permission denied accessing the Docker daemon. Confirm this application has access to the "
          + "configured Docker socket or remote endpoint.";
    }
    if (msg.contains("ssl") || msg.contains("certificate") || msg.contains("handshake")) {
      return "TLS handshake failed connecting to the Docker daemon. Confirm the configured TLS certificates "
          + "are valid for this endpoint.";
    }
    // Reactor's own .timeout() operator (Legacy Remediation Slice 3's
    // Test Connection bound) raises java.util.concurrent.TimeoutException
    // with a message like "Did not observe any item ... within 5000ms" -
    // the type itself, not message text, is the reliable signal, the same
    // pattern already used for UnknownHostException above.
    if (root instanceof java.util.concurrent.TimeoutException || msg.contains("timed out") || msg.contains("timeout")) {
      return "Timed out connecting to the Docker daemon. Confirm the configured host and port are correct "
          + "and reachable.";
    }
    if (msg.contains("no route to host") || msg.contains("unknown host") || msg.contains("unresolved")) {
      return "Cannot reach the configured Docker host. Confirm the host and port are correct.";
    }
    if (msg.contains("connection refused") || msg.contains("connect")) {
      return "Docker daemon unreachable - connection refused. Confirm the daemon is running and reachable "
          + "at the configured host/port.";
    }
    if (msg.contains("no such file") || msg.contains("socket")) {
      return "Docker daemon unreachable - the local Docker socket was not found. Confirm Docker is running "
          + "on this host.";
    }
    return "Docker daemon health check failed.";
  }

  private static Throwable rootCause(Throwable t) {
    Throwable current = t;
    while (current.getCause() != null && current.getCause() != current) {
      current = current.getCause();
    }
    return current;
  }
}
