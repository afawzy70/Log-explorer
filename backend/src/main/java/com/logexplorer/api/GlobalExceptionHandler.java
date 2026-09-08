package com.logexplorer.api;

import com.logexplorer.core.guard.GuardrailViolationException;
import com.logexplorer.core.guard.TooManyConcurrentLiveTailsException;
import com.logexplorer.core.guard.TooManyConcurrentSearchesException;
import com.logexplorer.core.query.QuerySyntaxException;
import com.logexplorer.source.DisabledSourceException;
import com.logexplorer.source.UnknownSourceException;
import java.util.concurrent.TimeoutException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.bind.support.WebExchangeBindException;

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

  @ExceptionHandler(Exception.class)
  public ProblemDetail handleGeneric(Exception e) {
    log.error("Unhandled exception", e);
    return ProblemDetail.forStatusAndDetail(HttpStatus.INTERNAL_SERVER_ERROR, "An internal error occurred");
  }
}
