package com.logexplorer.core.guard;

/** A {@link SearchGuardrails#validate} rejection. Maps to HTTP 400. */
public class GuardrailViolationException extends RuntimeException {

  public enum Reason {
    MISSING_RANGE, INVALID_RANGE, MAX_RANGE_EXCEEDED, INVALID_LIMIT, RAW_LOGQL_NOT_SUPPORTED,
    /** {@code JourneyRequestDto#field} is not one of the four non-sensitive identifiers (Phase I). */
    INVALID_JOURNEY_FIELD,
    /** The requested source's {@code SourceCapabilities#liveTail()} is false (Phase J) - "Do not fake it." */
    LIVE_TAIL_NOT_SUPPORTED,
    /**
     * A {@code SearchRequest#cursor()} that failed integrity verification,
     * failed to parse, or does not match the rest of the current request
     * (Legacy Remediation Slice 1) - covers a tampered cursor, a cursor
     * replayed against a different source/time-range/filter set, and a
     * simply malformed cursor alike. The message never echoes the
     * cursor's own value or decoded contents.
     */
    INVALID_CURSOR,
    /**
     * OS-1D review recovery — a "Show surrounding logs" context request
     * named a (pod, container) target that is neither in the current
     * OS-1B resolved scope nor backed by a valid, server-issued historical
     * scope proof ({@code core.search.ContextTargetProofCodec}). Covers a
     * missing proof, a tampered/forged proof, and a proof whose source/
     * connection-generation/namespace/pod/container do not exactly match
     * the requested target alike — the message is always the same fixed
     * string and never reveals which check failed or whether the named
     * pod/container actually exists, so this can never become an oracle
     * for probing arbitrary pod names.
     */
    INVALID_CONTEXT_TARGET
  }

  private final Reason reason;

  public GuardrailViolationException(Reason reason, String message) {
    super(message);
    this.reason = reason;
  }

  public Reason reason() {
    return reason;
  }
}
