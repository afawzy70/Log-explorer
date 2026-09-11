package com.logexplorer.source.openshift;

import java.net.InetAddress;
import java.net.UnknownHostException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Refuses OpenShift credential intake unless this application is bound to
 * a loopback address (OS-1A §10).
 *
 * <h2>Why this exists</h2>
 *
 * <p>The OS-A assessment identified runtime credential intake as
 * acceptable <b>only</b> under the local desktop model, and required that
 * the condition be enforced rather than documented. The reason is
 * specific, not ceremonial: this application has <b>no authentication of
 * its own</b> - {@code DockerSettingsController}'s javadoc states plainly
 * that there is "no authenticated admin boundary (no Spring Security, no
 * {@code @PreAuthorize}, nothing gating any endpoint by identity)". Every
 * endpoint is open to whoever can reach the port.
 *
 * <p>That is fine when the only thing that can reach the port is the
 * developer's own machine. It stops being fine the moment the server is
 * bound to an interface other people can reach, because then an
 * unauthenticated stranger could post their own OpenShift token into the
 * running app - or, worse, use one already connected.
 *
 * <p>So the assumption that made credential intake safe is turned into a
 * checked precondition. A blank {@code server.address} counts as
 * <b>not</b> loopback: Spring Boot binds every interface when no address
 * is configured, which is exactly the case this guard exists to stop.
 */
@Component
public class LoopbackBindingGuard {

  private final String configuredAddress;

  public LoopbackBindingGuard(@Value("${server.address:}") String configuredAddress) {
    this.configuredAddress = configuredAddress;
  }

  /** Whether credential intake may be accepted on this binding. */
  public boolean isLoopbackBound() {
    return isLoopback(configuredAddress);
  }

  /**
   * @throws NonLoopbackBindingException when credential intake must be refused
   */
  public void requireLoopback() {
    if (!isLoopbackBound()) {
      throw new NonLoopbackBindingException();
    }
  }

  static boolean isLoopback(String address) {
    if (address == null || address.isBlank()) {
      // No bind address configured -> all interfaces. Refuse.
      return false;
    }
    String trimmed = address.trim();
    // "0.0.0.0" and "::" are the explicit all-interfaces forms. InetAddress
    // would resolve 0.0.0.0 to a wildcard that is not flagged as loopback,
    // but naming them makes the intent unmistakable to a future reader.
    if ("0.0.0.0".equals(trimmed) || "::".equals(trimmed) || "*".equals(trimmed)) {
      return false;
    }
    try {
      // Covers 127.0.0.1, any other 127.x.x.x, ::1 and the literal
      // "localhost", without this class having to enumerate them.
      return InetAddress.getByName(trimmed).isLoopbackAddress();
    } catch (UnknownHostException e) {
      // Unresolvable means we cannot prove it is loopback. Refuse - the
      // safe direction for a guard protecting credential intake.
      return false;
    }
  }

  /** Thrown when credential intake is attempted on a non-loopback binding. */
  public static class NonLoopbackBindingException extends RuntimeException {
    public NonLoopbackBindingException() {
      // Deliberately says nothing about the submitted credential.
      super("OpenShift sign-in is only available when Log Explorer is bound to a local (loopback) address. "
          + "This instance is reachable from the network, so credential entry is disabled.");
    }
  }
}
