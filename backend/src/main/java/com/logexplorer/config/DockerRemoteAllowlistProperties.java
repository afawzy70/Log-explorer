package com.logexplorer.config;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * {@code logexplorer.docker.remote-allowlist.*} (Legacy Remediation Slice
 * 3) — the explicit, admin-configured exception list {@code
 * source.docker.security.RemoteHostGuard} checks a resolved remote Docker
 * host against before falling back to its default-deny policy for
 * private/link-local/loopback/metadata addresses.
 *
 * <p>Empty by default: out of the box, remote Docker over a private LAN
 * address is rejected (deny-by-default is the safe default — CLAUDE.md's
 * own SSRF-defense-in-depth posture), and an operator who genuinely needs
 * to reach a corporate-LAN Docker host must explicitly say so here, either
 * by CIDR (e.g. {@code 10.20.0.0/16}) or by exact hostname (e.g. {@code
 * docker.internal.corp} — a hostname entry trusts that name completely,
 * skipping address classification for it entirely, since an admin who
 * named it explicitly already made the trust decision).
 */
@ConfigurationProperties(prefix = "logexplorer.docker.remote-allowlist")
public class DockerRemoteAllowlistProperties {

  private List<String> cidrs = List.of();
  private List<String> hostnames = List.of();

  public List<String> getCidrs() {
    return cidrs;
  }

  public void setCidrs(List<String> cidrs) {
    this.cidrs = cidrs == null ? List.of() : List.copyOf(cidrs);
  }

  public List<String> getHostnames() {
    return hostnames;
  }

  public void setHostnames(List<String> hostnames) {
    this.hostnames = hostnames == null ? List.of() : List.copyOf(hostnames);
  }
}
