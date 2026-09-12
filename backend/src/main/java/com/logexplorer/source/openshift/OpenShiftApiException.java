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
    /**
     * 404 on the OpenShift Projects API itself - the cluster genuinely has
     * no {@code project.openshift.io} API group (a vanilla Kubernetes API
     * server, not OpenShift). This is deliberately its own kind, separate
     * from {@link #MALFORMED_RESPONSE}: it is the <b>only</b> kind {@code
     * OpenShiftConnectionService}'s namespaces fallback may act on.
     *
     * <p>Review finding (OS-1A recovery): before this kind existed, every
     * non-401/403 HTTP status - including 429/500/502/503, i.e. real
     * cluster/rate-limit failures with nothing to do with whether the
     * Projects API exists - fell into {@code MALFORMED_RESPONSE} and could
     * incorrectly trigger the namespaces fallback. A busy or failing
     * cluster must never be reinterpreted as "this cluster has no
     * Projects API."
     */
    NOT_FOUND,
    /** TLS handshake/trust failure - usually an enterprise CA that has not been supplied. */
    TLS,
    /** DNS/connect/timeout - typically VPN or reachability. */
    NETWORK,
    /** The configured proxy could not be used. */
    PROXY,
    /**
     * Every other unexpected outcome: a decode failure on a 2xx response,
     * or any HTTP status this client does not give its own kind to (429
     * rate-limited, 500/502/503 upstream failures, etc.). Deliberately
     * <b>not</b> eligible for the namespaces fallback - only a genuine 404
     * ({@link #NOT_FOUND}) means "no Projects API"; everything else here
     * means "the Projects API exists but this call to it failed."
     */
    MALFORMED_RESPONSE,
    /**
     * OS-1C review recovery — the cluster API did not respond in time.
     * Deliberately its own kind, split out of what used to be folded into
     * {@link #NETWORK}: a DNS/connect failure ("nothing is listening
     * there") and a timeout ("something is listening but too slow/stuck")
     * are different truths a caller may want to treat differently (e.g.
     * OS-1C's own per-target runtime warnings distinguish
     * {@code TARGET_TIMEOUT} from a generic upstream error) — see the
     * class javadoc's own "these are not interchangeable" principle.
     */
    TIMEOUT,
    /**
     * OS-1C review recovery — none of the resolved pod/container log-fetch
     * targets for one search could be read at all, for a reason other than
     * permissions (that stays {@link #FORBIDDEN}, unchanged). Deliberately
     * its own kind rather than reusing {@link #NOT_FOUND} (scoped
     * specifically to "the Projects API itself does not exist on this
     * cluster") or {@link #NETWORK}/{@link #TIMEOUT} (connection-level,
     * not specific to a pod-log fetch that individually failed) — reusing
     * either would blur two genuinely different questions, the same
     * mistake OS-1A's own review already corrected once for
     * {@link #NOT_FOUND} vs {@link #MALFORMED_RESPONSE}.
     */
    UPSTREAM_UNAVAILABLE,
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
