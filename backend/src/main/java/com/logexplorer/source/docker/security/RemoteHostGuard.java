package com.logexplorer.source.docker.security;

import com.logexplorer.config.DockerRemoteAllowlistProperties;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * SSRF/DNS-rebinding guard for remote Docker connections (Legacy
 * Remediation Slice 3, {@code docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md}
 * §"Slice 3" — "Remote Docker connection input is server-side network
 * access and must be treated as SSRF-sensitive"). Applies identically to
 * runtime Docker construction ({@code source.docker.DockerClientFactory})
 * and Test Connection ({@code api.DockerSettingsController}) — the same
 * method, same policy, called fresh (never cached) immediately before each
 * real operation, so a rebound DNS answer between checks is never trusted.
 *
 * <p><b>Policy</b>: resolve {@code host} server-side (never trust a
 * client-supplied IP directly, and never validate only in the frontend);
 * reject if resolution fails; reject if <i>any</i> resolved address is
 * loopback, link-local (this alone covers the well-known cloud metadata
 * endpoint {@code 169.254.169.254}), private/site-local (RFC1918),
 * multicast, "any" (0.0.0.0/::), or one of a short list of other
 * special-purpose ranges (CGNAT, IPv6 unique-local, "this network") —
 * <i>unless</i> that address falls within an explicitly admin-configured
 * allowlisted CIDR, or the host name itself is an explicitly
 * admin-configured allowlisted hostname (which skips address
 * classification entirely — an admin who named it already made the trust
 * decision). Ordinary public addresses are allowed by default; private
 * corporate LAN Docker is a legitimate use case, but only when explicitly
 * allowlisted — see {@link DockerRemoteAllowlistProperties}'s own javadoc
 * for why the default is deny, not a blanket RFC1918 block.
 */
@Component
public class RemoteHostGuard {

  /**
   * Special-purpose ranges {@link InetAddress}'s own classification
   * methods ({@code isLoopbackAddress}/{@code isLinkLocalAddress}/{@code
   * isSiteLocalAddress}/{@code isMulticastAddress}/{@code isAnyLocalAddress})
   * don't already cover: IPv4 CGNAT (100.64.0.0/10 — several cloud
   * providers route metadata endpoints through here), the IPv4 "this
   * network" block (0.0.0.0/8), and IPv6 unique-local addresses
   * (fc00::/7) — {@code isSiteLocalAddress()} only recognizes the older,
   * deprecated {@code fec0::/10} range, not modern ULA.
   */
  private static final List<String> BUILTIN_DENY_CIDRS = List.of(
      "100.64.0.0/10",
      "0.0.0.0/8",
      "fc00::/7");

  private final DockerRemoteAllowlistProperties allowlist;
  private final HostResolver resolver;

  public RemoteHostGuard(DockerRemoteAllowlistProperties allowlist, HostResolver resolver) {
    this.allowlist = allowlist;
    this.resolver = resolver;
  }

  /**
   * @throws RemoteHostRejectedException with {@link RemoteHostRejectedException.Reason#DNS_FAILURE}
   *     if {@code host} cannot be resolved at all, or {@link RemoteHostRejectedException.Reason#POLICY_REJECTED}
   *     if it resolves but any resolved address (mixed resolution: even
   *     one forbidden address is enough) is not permitted.
   */
  public void checkOrThrow(String host) {
    if (host == null || host.isBlank()) {
      throw new RemoteHostRejectedException(RemoteHostRejectedException.Reason.POLICY_REJECTED, "Host must not be blank");
    }

    InetAddress[] resolved;
    try {
      resolved = resolver.resolve(host);
    } catch (UnknownHostException e) {
      throw new RemoteHostRejectedException(
          RemoteHostRejectedException.Reason.DNS_FAILURE, "Could not resolve the configured Docker host", e);
    }
    if (resolved == null || resolved.length == 0) {
      throw new RemoteHostRejectedException(
          RemoteHostRejectedException.Reason.DNS_FAILURE, "Could not resolve the configured Docker host");
    }

    if (isHostnameAllowlisted(host)) {
      return;
    }

    for (InetAddress address : resolved) {
      if (!isAllowedAddress(address)) {
        throw new RemoteHostRejectedException(
            RemoteHostRejectedException.Reason.POLICY_REJECTED,
            "The configured Docker host resolves to an address that is not permitted by policy");
      }
    }
  }

  private boolean isHostnameAllowlisted(String host) {
    return allowlist.getHostnames().stream().anyMatch(h -> h.equalsIgnoreCase(host));
  }

  private boolean isAllowedAddress(InetAddress address) {
    if (matchesAnyCidr(address, allowlist.getCidrs())) {
      return true;
    }
    return !isForbiddenByDefaultPolicy(address);
  }

  private boolean isForbiddenByDefaultPolicy(InetAddress address) {
    if (address.isLoopbackAddress()
        || address.isLinkLocalAddress()
        || address.isSiteLocalAddress()
        || address.isMulticastAddress()
        || address.isAnyLocalAddress()) {
      return true;
    }
    return matchesAnyCidr(address, BUILTIN_DENY_CIDRS);
  }

  private boolean matchesAnyCidr(InetAddress address, List<String> cidrs) {
    return cidrs.stream().anyMatch(cidr -> matchesCidr(address, cidr));
  }

  private boolean matchesCidr(InetAddress address, String cidr) {
    String trimmed = cidr.trim();
    int slash = trimmed.indexOf('/');
    String baseHost = slash >= 0 ? trimmed.substring(0, slash) : trimmed;
    InetAddress base;
    try {
      base = InetAddress.getByName(baseHost);
    } catch (UnknownHostException e) {
      // A malformed allowlist entry must never silently widen access -
      // treat it as matching nothing, same posture as any other
      // fail-closed check in this class.
      return false;
    }
    byte[] addressBytes = address.getAddress();
    byte[] baseBytes = base.getAddress();
    if (addressBytes.length != baseBytes.length) {
      return false; // IPv4 vs IPv6 family mismatch - never cross-match
    }
    int prefixLength = slash >= 0
        ? Integer.parseInt(trimmed.substring(slash + 1))
        : (base instanceof Inet4Address ? 32 : 128);

    int fullBytes = prefixLength / 8;
    int remainderBits = prefixLength % 8;
    for (int i = 0; i < fullBytes; i++) {
      if (addressBytes[i] != baseBytes[i]) {
        return false;
      }
    }
    if (remainderBits > 0) {
      int mask = (0xFF << (8 - remainderBits)) & 0xFF;
      if ((addressBytes[fullBytes] & mask) != (baseBytes[fullBytes] & mask)) {
        return false;
      }
    }
    return true;
  }
}
