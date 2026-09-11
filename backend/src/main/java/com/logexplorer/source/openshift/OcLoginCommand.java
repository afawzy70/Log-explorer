package com.logexplorer.source.openshift;

import com.logexplorer.core.model.RawToken;
import java.net.URI;

/**
 * The only three things OS-1A ever extracts from a pasted {@code oc login}
 * command: the API server URL, the bearer token, and (optionally) a
 * certificate-authority file path.
 *
 * <p>This is a <b>parse result</b>, never a command line. Nothing in this
 * codebase executes {@code oc}, and the {@code oc} binary is not a runtime
 * dependency (OS-A decision 2). The pasted text is treated exactly like
 * any other untrusted user input: it is matched against a strict grammar
 * and either yields these fields or is rejected outright.
 *
 * <p>{@code token} is a {@link RawToken} from the moment it exists, so it
 * cannot be logged by accident - {@link RawToken#toString()} is a fixed
 * redacted string regardless of value. {@link #toString()} here is
 * likewise redacted, because a parse result is exactly the kind of object
 * that ends up in a debug log or an exception message.
 */
public record OcLoginCommand(URI server, RawToken token, String certificateAuthorityPath) {

  public boolean hasCertificateAuthority() {
    return certificateAuthorityPath != null && !certificateAuthorityPath.isBlank();
  }

  /** Host:port of the API server - safe to show and safe to log. */
  public String serverDisplay() {
    int port = server.getPort();
    return port == -1 ? server.getHost() : server.getHost() + ":" + port;
  }

  @Override
  public String toString() {
    // The server is not sensitive; the token is, and must never widen the
    // blast radius of a stray log statement.
    return "OcLoginCommand[server=" + serverDisplay() + ", token=[REDACTED], ca=" + hasCertificateAuthority() + "]";
  }
}
