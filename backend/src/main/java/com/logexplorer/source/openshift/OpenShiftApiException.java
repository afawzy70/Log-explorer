package com.logexplorer.source.openshift;

/**
 * A failure talking to the OpenShift API, classified into the categories
 * the UI must be able to tell apart (OS-1A §15/§18).
 *
 * <p><b>These are not interchangeable.</b> OS-1A §15 is explicit, and it
 * corrects an earlier draft that collapsed them: a {@code 403} on project
 * discovery is <i>not</i> "you have no projects", and neither is a
 * successful response carrying an empty list. Three different truths:
 *
 * <ul>
 *   <li>{@link Kind#UNAUTHORIZED} - the token is invalid or expired; the
 *   user must re-authenticate.</li>
 *   <li>{@link Kind#FORBIDDEN} - the token is valid, but this user may not
 *   list projects. Saying "no accessible projects" here would be a lie
 *   that sends the user looking for the wrong problem.</li>
 *   <li>A {@code 200} carrying an empty list - the user genuinely has no
 *   projects. Represented as an empty result, not an exception.</li>
 * </ul>
 *
 * <p>Messages here are safe to show: they never contain the token, the
 * pasted command, or a response body.
 */
public class OpenShiftApiException extends RuntimeException {

  public enum Kind {
    /** 401 - token invalid or expired. */
    UNAUTHORIZED,
    /** 403 - authenticated but not permitted. */
    FORBIDDEN,
    /** TLS handshake/trust failure - usually an enterprise CA that has not been supplied. */
    TLS,
    /** DNS/connect/timeout - typically VPN or reachability. */
    NETWORK,
    /** The configured proxy could not be used. */
    PROXY,
    /** The endpoint answered, but not with anything this client understands. */
    MALFORMED_RESPONSE,
  }

  private final Kind kind;

  public OpenShiftApiException(Kind kind, String message) {
    super(message);
    this.kind = kind;
  }

  public OpenShiftApiException(Kind kind, String message, Throwable cause) {
    // The cause is kept for the stack trace only. Callers must never render
    // `cause.getMessage()` to the user or the log: a transport-layer
    // message can include the request URI, and the URI is built from
    // user-supplied input.
    super(message, cause);
    this.kind = kind;
  }

  public Kind kind() {
    return kind;
  }
}
