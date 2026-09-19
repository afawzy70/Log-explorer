package com.logexplorer.source.openshift;

import java.security.SecureRandom;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import reactor.util.context.Context;
import reactor.util.context.ContextView;

/**
 * OPENSHIFT_REAL_ENVIRONMENT_BUFFER_BUG_RECOVERY_2 Step 1A — observational,
 * production-safe diagnostic logging for the OpenShift connection
 * lifecycle, so a future failure can be reconstructed from application
 * logs alone rather than requiring a raw Reactor/Netty stack trace to be
 * captured and hand-interpreted.
 *
 * <p><b>Correlation.</b> One random, short, non-sequential {@code
 * attemptId} per {@link OpenShiftConnectionService#connect} call, carried
 * through the reactive chain via a Reactor {@link Context} entry (never a
 * {@code ThreadLocal}/MDC — Reactor operators routinely hop threads, and
 * MDC does not follow without extra bridging machinery this change does
 * not need). Every log line this class emits for one Connect attempt
 * carries the same {@code attemptId}.
 *
 * <p><b>Security (hard requirement, CLAUDE.md §2 / this mission's own
 * "LOGGING SECURITY" section).</b> Every method here takes only already-
 * safe, structural values (operation name, HTTP status, duration,
 * exception class name, an already-sanitized message) — never a token, an
 * {@code Authorization} header, a raw response body, or a raw URI (which
 * could carry credentials in a query string). {@link
 * OpenShiftApiClientHttpsBufferLifecycleTest}'s {@code
 * connectLifecycleLogsNeverLeakTheBearerTokenOrLoginCommand} test asserts
 * this directly against captured log output, not just by code review.
 *
 * <p><b>Volume.</b> Connect/discovery is inherently low-frequency (an
 * occasional user action), so every method here is safe to call
 * unconditionally at its stated level - this class is deliberately never
 * used on the pod-log/live-tail streaming path (which would violate the
 * mission's own "MUST NOT emit one application diagnostic log per
 * incoming log line" bound); see {@link OpenShiftApiClient}'s
 * {@code LineDecodingSubscriber}/{@code BoundedBodyCollector} for that
 * path's own separately-bounded diagnostics.
 */
final class OpenShiftConnectDiagnostics {

  private static final Logger log = LoggerFactory.getLogger("com.logexplorer.source.openshift.connect");
  private static final SecureRandom RANDOM = new SecureRandom();
  private static final String CONTEXT_KEY = "openshiftConnectionAttemptId";

  private OpenShiftConnectDiagnostics() {
  }

  /** A short (8 hex chars), non-sequential, non-sensitive correlation id - never derived from the token or command. */
  static String newAttemptId() {
    return Long.toHexString(RANDOM.nextLong()).substring(0, 8);
  }

  static Context withAttemptId(Context context, String attemptId) {
    return context.put(CONTEXT_KEY, attemptId);
  }

  /** {@code "unknown"} for any context this class did not itself establish (e.g. a direct unit-test call) - never null, never throws. */
  static String attemptId(ContextView context) {
    return context.getOrDefault(CONTEXT_KEY, "unknown");
  }

  // ------------------------------------------------------------- INFO: Connect lifecycle

  static void connectStarted(String attemptId) {
    log.info("OPENSHIFT_CONNECT_STARTED attemptId={}", attemptId);
  }

  static void connectSucceeded(String attemptId, long durationMs) {
    log.info("OPENSHIFT_CONNECT_SUCCEEDED attemptId={} durationMs={}", attemptId, durationMs);
  }

  static void connectFailed(String attemptId, long durationMs, Throwable error) {
    ExceptionChain chain = ExceptionChain.of(error);
    log.warn("OPENSHIFT_CONNECT_FAILED attemptId={} durationMs={} exceptionClass={} cause1Class={} "
            + "cause2Class={} rootCauseClass={} rootCauseMessageSanitized={}",
        attemptId, durationMs, chain.topClass, chain.cause1Class, chain.cause2Class, chain.rootCauseClass,
        chain.rootCauseMessageSanitized);
    // Full stack trace at DEBUG only - the INFO/WARN line above is the
    // permanent, low-volume record; the trace is for active troubleshooting
    // (see the "troubleshooting mode" doc this mission also adds).
    log.debug("OPENSHIFT_CONNECT_FAILED_TRACE attemptId={}", attemptId, error);
  }

  // ------------------------------------------------------- INFO: one HTTP operation

  static void requestStarted(String attemptId, String operation) {
    log.info("OPENSHIFT_HTTP_REQUEST_STARTED attemptId={} operation={} method=GET", attemptId, operation);
  }

  static void responseCompleted(String attemptId, String operation, long durationMs, String responseContentType) {
    log.info("OPENSHIFT_HTTP_RESPONSE_COMPLETED attemptId={} operation={} status=200 durationMs={} "
            + "responseContentType={}",
        attemptId, operation, durationMs, responseContentType == null ? "unknown" : responseContentType);
  }

  static void requestFailed(String attemptId, String operation, long durationMs, Throwable error) {
    ExceptionChain chain = ExceptionChain.of(error);
    log.warn("OPENSHIFT_HTTP_REQUEST_FAILED attemptId={} operation={} durationMs={} exceptionClass={} "
            + "exceptionStage={}",
        attemptId, operation, durationMs, chain.topClass, "bodyDecodeOrTransport");
  }

  // ------------------------------------------------------------- DEBUG: reactive lifecycle

  static void debugSignal(String attemptId, String operation, String signalType) {
    if (log.isDebugEnabled()) {
      log.debug("OPENSHIFT_HTTP_SIGNAL attemptId={} operation={} signalType={} threadName={}",
          attemptId, operation, signalType, Thread.currentThread().getName());
    }
  }

  /** A single, safe, bounded operation label for an internal path - never the raw path (which is not user input here, but keeping it to a closed set avoids ever accidentally logging a query-string credential added later). */
  static String operationFor(String path) {
    if (path == null) {
      return "UNKNOWN";
    }
    if (path.contains("/users/")) {
      return "FETCH_USER";
    }
    if (path.contains("/projects")) {
      return "FETCH_PROJECTS";
    }
    if (path.contains("/namespaces") && !path.contains("/pods/")) {
      return "FETCH_NAMESPACES";
    }
    if (path.contains("/pods/") && path.endsWith("/log")) {
      return "FETCH_POD_LOG";
    }
    return "OTHER";
  }

  /** Compact, log-safe cause-chain summary - message text is deliberately dropped except for the sanitized root cause (see {@link #sanitize}). */
  private record ExceptionChain(
      String topClass, String cause1Class, String cause2Class, String rootCauseClass, String rootCauseMessageSanitized) {

    static ExceptionChain of(Throwable error) {
      Throwable top = error;
      Throwable c1 = top == null ? null : top.getCause();
      Throwable c2 = c1 == null ? null : c1.getCause();
      Throwable root = top;
      int guard = 0;
      while (root != null && root.getCause() != null && root.getCause() != root && guard++ < 20) {
        root = root.getCause();
      }
      return new ExceptionChain(
          className(top), className(c1), className(c2), className(root),
          sanitize(root == null ? null : root.getMessage()));
    }

    private static String className(Throwable t) {
      return t == null ? "none" : t.getClass().getName();
    }
  }

  /**
   * Defense-in-depth (this mission's own "sanitize exception messages...
   * library exceptions may occasionally contain URLs or other environment
   * information"). A library exception's message is not attacker input
   * here, but nothing in this codebase's exception messages is ever
   * expected to legitimately need a bearer token or {@code Authorization}
   * value in it either — if one is somehow present (e.g. a future library
   * upgrade changes what an exception embeds), it must never reach a log
   * line. Bounded length; case-insensitive scan for the two sensitive
   * markers this mission names explicitly.
   */
  static String sanitize(String message) {
    if (message == null) {
      return "none";
    }
    String truncated = message.length() > 200 ? message.substring(0, 200) + "..." : message;
    String lower = truncated.toLowerCase(java.util.Locale.ROOT);
    if (lower.contains("bearer ") || lower.contains("authorization")) {
      return "[redacted - message contained a credential-shaped token]";
    }
    return truncated;
  }

  static long millisSince(long startNanos) {
    return Duration.ofNanos(System.nanoTime() - startNanos).toMillis();
  }
}
