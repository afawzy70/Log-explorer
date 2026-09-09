package com.logexplorer.source.docker.security;

/**
 * {@link RemoteHostGuard} rejection (Legacy Remediation Slice 3). Maps to
 * HTTP 400 for Test Connection and to a sanitized {@code
 * source.docker.DockerDiagnostics} health message for runtime Docker — in
 * both cases the message is always a fixed, generic string (never the raw
 * host/hostname/IP or any exception internals), only {@link #reason()}
 * distinguishes "could not resolve this host at all" from "resolved, but
 * to an address policy forbids."
 */
public class RemoteHostRejectedException extends RuntimeException {

  public enum Reason { DNS_FAILURE, POLICY_REJECTED }

  private final Reason reason;

  public RemoteHostRejectedException(Reason reason, String message) {
    super(message);
    this.reason = reason;
  }

  public RemoteHostRejectedException(Reason reason, String message, Throwable cause) {
    super(message, cause);
    this.reason = reason;
  }

  public Reason reason() {
    return reason;
  }
}
