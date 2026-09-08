package com.logexplorer.source.docker;

import com.logexplorer.core.model.SourceHealth;
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
    if (msg.contains("timed out") || msg.contains("timeout")) {
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
