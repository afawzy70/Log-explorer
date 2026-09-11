package com.logexplorer.source.openshift;

/**
 * A pasted {@code oc login} command was rejected.
 *
 * <p><b>The message names the rule that was violated and never echoes the
 * input</b> (OS-1A §7). That is not politeness - the input is a command
 * line containing a bearer token, so echoing any part of it back into an
 * error response, a log line or a UI toast would defeat the entire token
 * security model. The same discipline UX-R6 applied to search errors,
 * which are asserted never to repeat the investigator's typed value.
 *
 * <p>{@link Reason} exists so the frontend can distinguish causes and say
 * something precise ("that is not an https:// server URL") without the
 * backend having to hand it any part of the offending text.
 */
public class OcLoginParseException extends RuntimeException {

  public enum Reason {
    /** The text does not look like an `oc login` command at all. */
    NOT_AN_OC_LOGIN_COMMAND,
    /** Shell metacharacters or shell syntax present anywhere in the input. */
    SHELL_SYNTAX_PRESENT,
    /** A flag this parser does not explicitly support - rejected, never ignored. */
    UNKNOWN_FLAG,
    /** The same critical flag appeared more than once. */
    DUPLICATE_FLAG,
    /** `--server` absent. */
    MISSING_SERVER,
    /** `--token` absent. */
    MISSING_TOKEN,
    /** `--server` is not a syntactically valid absolute URL. */
    MALFORMED_SERVER_URL,
    /** `--server` is not https. */
    SERVER_NOT_HTTPS,
    /** `--insecure-skip-tls-verify` present - refused, never honoured. */
    INSECURE_TLS_REFUSED,
    /** The token value is empty or structurally implausible. */
    MALFORMED_TOKEN,
  }

  private final Reason reason;

  public OcLoginParseException(Reason reason, String message) {
    super(message);
    this.reason = reason;
  }

  public Reason reason() {
    return reason;
  }
}
