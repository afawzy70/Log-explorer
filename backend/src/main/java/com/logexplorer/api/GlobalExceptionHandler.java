package com.logexplorer.api;

import com.logexplorer.core.guard.GuardrailViolationException;
import com.logexplorer.core.guard.TooManyConcurrentLiveTailsException;
import com.logexplorer.core.guard.TooManyConcurrentSearchesException;
import com.logexplorer.core.query.QuerySyntaxException;
import com.logexplorer.source.DisabledSourceException;
import com.logexplorer.source.openshift.LoopbackBindingGuard;
import com.logexplorer.source.openshift.OcLoginParseException;
import com.logexplorer.source.openshift.OpenShiftApiException;
import com.logexplorer.source.openshift.OpenShiftConnectionService;
import com.logexplorer.source.openshift.OpenShiftScopeService;
import com.logexplorer.source.UnknownSourceException;
import java.util.concurrent.TimeoutException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.bind.support.WebExchangeBindException;
import org.springframework.web.server.ResponseStatusException;

/**
 * Maps every exception this backend can throw to a sanitized {@link
 * ProblemDetail} (RFC 7807). No handler here ever echoes a raw sensitive
 * value, a search's free-text value, or an unexpected exception's raw
 * message (CLAUDE.md §2 rule 2) — every message here is either a fixed
 * string or built entirely from non-sensitive structural request data
 * (source id, time range, limit).
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

  private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

  @ExceptionHandler(UnknownSourceException.class)
  public ProblemDetail handleUnknownSource(UnknownSourceException e) {
    return ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, "Unknown source");
  }

  @ExceptionHandler(DisabledSourceException.class)
  public ProblemDetail handleDisabledSource(DisabledSourceException e) {
    return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "Source is disabled");
  }

  /*
   * OS-1A - OpenShift connection failures.
   *
   * Each kind maps to its own status and carries a machine-readable
   * `reason`, because OS-1A §15/§18 require the UI to tell these apart:
   * "the token expired", "you may not list projects" and "you have no
   * projects" are three different truths and must never collapse into one
   * "connection failed". None of these messages can contain the token or
   * the pasted command - see `OcLoginParseException` and
   * `OpenShiftApiException` for where that is enforced.
   */
  @ExceptionHandler(OcLoginParseException.class)
  public ProblemDetail handleOcLoginParse(OcLoginParseException e) {
    ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, e.getMessage());
    problem.setProperty("reason", e.reason().name());
    return problem;
  }

  @ExceptionHandler(OpenShiftApiException.class)
  public ProblemDetail handleOpenShiftApi(OpenShiftApiException e) {
    HttpStatus status = switch (e.kind()) {
      case UNAUTHORIZED -> HttpStatus.UNAUTHORIZED;
      case FORBIDDEN -> HttpStatus.FORBIDDEN;
      // TLS / network / proxy are failures reaching an upstream, not
      // client mistakes - 502 is the honest shape.
      case TLS, NETWORK, PROXY -> HttpStatus.BAD_GATEWAY;
      // NOT_FOUND (the Projects API itself is genuinely absent),
      // MALFORMED_RESPONSE (anything else unexpected, incl. 429/5xx
      // upstream failures), and UPSTREAM_UNAVAILABLE (OS-1C review
      // recovery: none of a search's resolved pod-log targets could be
      // read) all describe a real cluster-side condition, not a mistake by
      // our caller - 502 is honest here too. NOT_FOUND/MALFORMED_RESPONSE
      // only reach the client if the namespaces fallback also failed (see
      // OpenShiftConnectionService.fallbackToNamespacesIfAppropriate).
      case NOT_FOUND, MALFORMED_RESPONSE, UPSTREAM_UNAVAILABLE -> HttpStatus.BAD_GATEWAY;
      // TIMEOUT (OS-1C review recovery) gets its own, more precise status
      // than the generic 502 the other upstream-failure kinds share.
      case TIMEOUT -> HttpStatus.GATEWAY_TIMEOUT;
    };
    ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, e.getMessage());
    problem.setProperty("reason", e.kind().name());
    return problem;
  }

  @ExceptionHandler(LoopbackBindingGuard.NonLoopbackBindingException.class)
  public ProblemDetail handleNonLoopbackBinding(LoopbackBindingGuard.NonLoopbackBindingException e) {
    ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.FORBIDDEN, e.getMessage());
    problem.setProperty("reason", "NON_LOOPBACK_BINDING");
    return problem;
  }

  @ExceptionHandler(OpenShiftConnectionService.StaleConnectionException.class)
  public ProblemDetail handleStaleOpenShiftConnection(OpenShiftConnectionService.StaleConnectionException e) {
    ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, e.getMessage());
    problem.setProperty("reason", "STALE_CONNECTION");
    return problem;
  }

  /**
   * OS-1B - a workload/pod discovery result belonged to a project or
   * workload selection that has since changed (OS-1B §15) - the same
   * "discard, don't overwrite" truth as {@link
   * OpenShiftConnectionService.StaleConnectionException}, one scope level
   * deeper, kept as its own reason so the two are distinguishable.
   */
  @ExceptionHandler(OpenShiftScopeService.StaleScopeException.class)
  public ProblemDetail handleStaleOpenShiftScope(OpenShiftScopeService.StaleScopeException e) {
    ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, e.getMessage());
    problem.setProperty("reason", "STALE_SCOPE");
    return problem;
  }

  @ExceptionHandler(GuardrailViolationException.class)
  public ProblemDetail handleGuardrailViolation(GuardrailViolationException e) {
    ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, e.getMessage());
    problem.setProperty("reason", e.reason().name());
    return problem;
  }

  @ExceptionHandler(QuerySyntaxException.class)
  public ProblemDetail handleQuerySyntax(QuerySyntaxException e) {
    // e.getMessage() is already guaranteed never to contain a literal
    // query value or arbitrary raw substring - see QuerySyntaxException's
    // own javadoc for the invariant every throw site in core.query upholds.
    ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, e.getMessage());
    problem.setProperty("position", e.position());
    return problem;
  }

  @ExceptionHandler(TooManyConcurrentSearchesException.class)
  public ProblemDetail handleTooManyConcurrent(TooManyConcurrentSearchesException e) {
    return ProblemDetail.forStatusAndDetail(HttpStatus.TOO_MANY_REQUESTS, e.getMessage());
  }

  @ExceptionHandler(TooManyConcurrentLiveTailsException.class)
  public ProblemDetail handleTooManyConcurrentLiveTails(TooManyConcurrentLiveTailsException e) {
    return ProblemDetail.forStatusAndDetail(HttpStatus.TOO_MANY_REQUESTS, e.getMessage());
  }

  @ExceptionHandler(TimeoutException.class)
  public ProblemDetail handleTimeout(TimeoutException e) {
    return ProblemDetail.forStatusAndDetail(HttpStatus.GATEWAY_TIMEOUT, "The search timed out");
  }

  @ExceptionHandler(WebExchangeBindException.class)
  public ProblemDetail handleValidation(WebExchangeBindException e) {
    return ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "Invalid request");
  }

  /**
   * A real bug found during Phase K's SPA-fallback work: {@link
   * org.springframework.web.reactive.resource.NoResourceFoundException}
   * (thrown for any genuinely unmatched path, incl. the SPA fallback's own
   * resource-chain dead-end) extends {@link ResponseStatusException} but
   * was previously falling through to {@link #handleGeneric}, silently
   * turning every honest 404 into a misleading 500 "An internal error
   * occurred". This preserves the exception's own real status - never
   * downgrading a client error into a fabricated server error - and its
   * structural (never sensitive) reason text, e.g. the unmatched path.
   */
  @ExceptionHandler(ResponseStatusException.class)
  public ProblemDetail handleResponseStatus(ResponseStatusException e) {
    String detail = e.getReason() != null ? e.getReason() : e.getMessage();
    return ProblemDetail.forStatusAndDetail(HttpStatus.valueOf(e.getStatusCode().value()), detail);
  }

  @ExceptionHandler(Exception.class)
  public ProblemDetail handleGeneric(Exception e) {
    log.error("Unhandled exception", e);
    return ProblemDetail.forStatusAndDetail(HttpStatus.INTERNAL_SERVER_ERROR, "An internal error occurred");
  }
}
