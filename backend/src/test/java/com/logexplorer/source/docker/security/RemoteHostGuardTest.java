package com.logexplorer.source.docker.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.logexplorer.config.DockerRemoteAllowlistProperties;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

/**
 * SSRF/DNS-rebinding policy tests (Legacy Remediation Slice 3,
 * {@code docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md} §"Slice 3" required test
 * list: "loopback rejection, metadata rejection, private LAN blocked by
 * default, allowlisted private LAN accepted, mixed DNS resolution where
 * one address is forbidden -> reject, hostname re-resolution, test and
 * runtime using same policy"). Uses a stub {@link HostResolver} throughout
 * - never a real network lookup - so every case here is deterministic and
 * offline.
 */
class RemoteHostGuardTest {

  private static HostResolver fixedResolver(String host, String... addresses) {
    return h -> {
      if (!h.equals(host)) {
        throw new UnknownHostException(h);
      }
      InetAddress[] result = new InetAddress[addresses.length];
      for (int i = 0; i < addresses.length; i++) {
        try {
          result[i] = InetAddress.getByName(addresses[i]);
        } catch (UnknownHostException e) {
          throw new AssertionError("test fixture address literal must always parse: " + addresses[i], e);
        }
      }
      return result;
    };
  }

  private static RemoteHostGuard guardWith(DockerRemoteAllowlistProperties allowlist, HostResolver resolver) {
    return new RemoteHostGuard(allowlist, resolver);
  }

  private static DockerRemoteAllowlistProperties emptyAllowlist() {
    return new DockerRemoteAllowlistProperties();
  }

  @Test
  void rejectsLoopback() {
    RemoteHostGuard guard = guardWith(emptyAllowlist(), fixedResolver("host", "127.0.0.1"));
    assertThatThrownBy(() -> guard.checkOrThrow("host"))
        .isInstanceOf(RemoteHostRejectedException.class)
        .satisfies(e -> assertThat(((RemoteHostRejectedException) e).reason())
            .isEqualTo(RemoteHostRejectedException.Reason.POLICY_REJECTED));
  }

  @Test
  void rejectsIpv6Loopback() {
    RemoteHostGuard guard = guardWith(emptyAllowlist(), fixedResolver("host", "::1"));
    assertThatThrownBy(() -> guard.checkOrThrow("host")).isInstanceOf(RemoteHostRejectedException.class);
  }

  @Test
  void rejectsCloudMetadataAddress() {
    // 169.254.169.254 - the well-known AWS/GCP/Azure metadata endpoint -
    // falls within the link-local range, rejected by that check alone.
    RemoteHostGuard guard = guardWith(emptyAllowlist(), fixedResolver("host", "169.254.169.254"));
    assertThatThrownBy(() -> guard.checkOrThrow("host")).isInstanceOf(RemoteHostRejectedException.class);
  }

  @Test
  void rejectsPrivateLanByDefault() {
    RemoteHostGuard guard = guardWith(emptyAllowlist(), fixedResolver("host", "10.20.30.40"));
    assertThatThrownBy(() -> guard.checkOrThrow("host")).isInstanceOf(RemoteHostRejectedException.class);
  }

  @Test
  void rejectsEveryRfc1918Range() {
    // 10.0.0.0/8
    assertThatThrownBy(() -> guardWith(emptyAllowlist(), fixedResolver("h10", "10.1.2.3")).checkOrThrow("h10"))
        .isInstanceOf(RemoteHostRejectedException.class);
    // 172.16.0.0/12
    assertThatThrownBy(() -> guardWith(emptyAllowlist(), fixedResolver("h172", "172.16.5.5")).checkOrThrow("h172"))
        .isInstanceOf(RemoteHostRejectedException.class);
    // 192.168.0.0/16
    assertThatThrownBy(() -> guardWith(emptyAllowlist(), fixedResolver("h192", "192.168.1.1")).checkOrThrow("h192"))
        .isInstanceOf(RemoteHostRejectedException.class);
  }

  @Test
  void rejectsCgnatRange() {
    // 100.64.0.0/10 - carrier-grade NAT, some cloud metadata routes here too.
    RemoteHostGuard guard = guardWith(emptyAllowlist(), fixedResolver("host", "100.64.1.1"));
    assertThatThrownBy(() -> guard.checkOrThrow("host")).isInstanceOf(RemoteHostRejectedException.class);
  }

  @Test
  void rejectsIpv6UniqueLocalRange() {
    // fc00::/7 - modern IPv6 ULA, not covered by InetAddress#isSiteLocalAddress().
    RemoteHostGuard guard = guardWith(emptyAllowlist(), fixedResolver("host", "fd12:3456:789a::1"));
    assertThatThrownBy(() -> guard.checkOrThrow("host")).isInstanceOf(RemoteHostRejectedException.class);
  }

  @Test
  void allowsAnOrdinaryPublicAddressByDefault() {
    RemoteHostGuard guard = guardWith(emptyAllowlist(), fixedResolver("host", "203.0.113.5")); // TEST-NET-3, public-shaped
    guard.checkOrThrow("host"); // must not throw
  }

  @Test
  void allowlistedPrivateLanCidrIsAccepted() {
    DockerRemoteAllowlistProperties allowlist = emptyAllowlist();
    allowlist.setCidrs(List.of("10.20.0.0/16"));
    RemoteHostGuard guard = guardWith(allowlist, fixedResolver("host", "10.20.5.5"));

    guard.checkOrThrow("host"); // must not throw - explicitly allowlisted
  }

  @Test
  void aDifferentPrivateLanCidrOutsideTheAllowlistIsStillRejected() {
    DockerRemoteAllowlistProperties allowlist = emptyAllowlist();
    allowlist.setCidrs(List.of("10.20.0.0/16"));
    RemoteHostGuard guard = guardWith(allowlist, fixedResolver("host", "10.30.5.5")); // different /16

    assertThatThrownBy(() -> guard.checkOrThrow("host")).isInstanceOf(RemoteHostRejectedException.class);
  }

  /**
   * Pre-merge self-audit finding (Slice 3, section 4 "allowlist safety"):
   * {@code InetAddress.getByName("")} resolves to the loopback address, so
   * a blank CIDR list entry (e.g. a stray trailing comma in a
   * comma-separated env var, producing an empty element) must never be
   * allowed to silently become "allowlist 127.0.0.1/32" - that would let a
   * config typo accidentally reopen the loopback SSRF path Test Connection
   * otherwise blocks by default.
   */
  @Test
  void aBlankCidrAllowlistEntryNeverAccidentallyAllowlistsLoopback() {
    DockerRemoteAllowlistProperties allowlist = emptyAllowlist();
    allowlist.setCidrs(List.of("10.20.0.0/16", "", "  "));
    RemoteHostGuard guard = guardWith(allowlist, fixedResolver("host", "127.0.0.1"));

    assertThatThrownBy(() -> guard.checkOrThrow("host"))
        .isInstanceOf(RemoteHostRejectedException.class)
        .satisfies(e -> assertThat(((RemoteHostRejectedException) e).reason())
            .isEqualTo(RemoteHostRejectedException.Reason.POLICY_REJECTED));
  }

  @Test
  void aMalformedCidrPrefixFailsClosedRatherThanThrowingAnUncaughtException() {
    DockerRemoteAllowlistProperties allowlist = emptyAllowlist();
    allowlist.setCidrs(List.of("10.20.0.0/not-a-number"));
    RemoteHostGuard guard = guardWith(allowlist, fixedResolver("host", "10.20.5.5"));

    // The malformed entry must never match (fail closed) and must never
    // itself crash the check with a NumberFormatException - the private
    // address is still correctly rejected by the default-deny policy.
    assertThatThrownBy(() -> guard.checkOrThrow("host")).isInstanceOf(RemoteHostRejectedException.class);
  }

  @Test
  void anOutOfRangeCidrPrefixFailsClosedRatherThanThrowingAnUncaughtException() {
    DockerRemoteAllowlistProperties allowlist = emptyAllowlist();
    allowlist.setCidrs(List.of("10.20.0.0/999", "10.20.0.0/-1"));
    RemoteHostGuard guard = guardWith(allowlist, fixedResolver("host", "10.20.5.5"));

    assertThatThrownBy(() -> guard.checkOrThrow("host")).isInstanceOf(RemoteHostRejectedException.class);
  }

  @Test
  void allowlistedHostnameIsAcceptedEvenWhenItResolvesToAPrivateAddress() {
    DockerRemoteAllowlistProperties allowlist = emptyAllowlist();
    allowlist.setHostnames(List.of("docker.internal.corp"));
    RemoteHostGuard guard = guardWith(allowlist, fixedResolver("docker.internal.corp", "10.5.5.5"));

    guard.checkOrThrow("docker.internal.corp"); // must not throw
  }

  @Test
  void hostnameAllowlistMatchIsCaseInsensitive() {
    DockerRemoteAllowlistProperties allowlist = emptyAllowlist();
    allowlist.setHostnames(List.of("Docker.Internal.Corp"));
    RemoteHostGuard guard = guardWith(allowlist, fixedResolver("docker.internal.corp", "10.5.5.5"));

    guard.checkOrThrow("docker.internal.corp");
  }

  @Test
  void mixedDnsResolutionWhereOneAddressIsForbiddenIsRejectedEvenThoughAnotherIsAllowed() {
    RemoteHostGuard guard = guardWith(emptyAllowlist(), fixedResolver("host", "203.0.113.5", "10.0.0.1"));
    assertThatThrownBy(() -> guard.checkOrThrow("host")).isInstanceOf(RemoteHostRejectedException.class);
  }

  @Test
  void dnsResolutionFailureIsClassifiedDistinctlyFromAPolicyRejection() {
    HostResolver resolver = h -> {
      throw new UnknownHostException(h);
    };
    RemoteHostGuard guard = guardWith(emptyAllowlist(), resolver);

    assertThatThrownBy(() -> guard.checkOrThrow("bad-host"))
        .isInstanceOf(RemoteHostRejectedException.class)
        .satisfies(e -> assertThat(((RemoteHostRejectedException) e).reason())
            .isEqualTo(RemoteHostRejectedException.Reason.DNS_FAILURE));
  }

  @Test
  void resolutionFailureNeverEchoesTheRawHostInTheExceptionMessage() {
    String sentinelHost = "RAW-HOST-SENTINEL-91a2.invalid";
    HostResolver resolver = h -> {
      throw new UnknownHostException(h);
    };
    RemoteHostGuard guard = guardWith(emptyAllowlist(), resolver);

    assertThatThrownBy(() -> guard.checkOrThrow(sentinelHost))
        .satisfies(e -> assertThat(e.getMessage()).doesNotContain(sentinelHost));
  }

  @Test
  void blankHostIsRejectedWithoutEverConsultingTheResolver() {
    AtomicInteger calls = new AtomicInteger();
    HostResolver countingResolver = h -> {
      calls.incrementAndGet();
      return new InetAddress[0];
    };
    RemoteHostGuard guard = guardWith(emptyAllowlist(), countingResolver);

    assertThatThrownBy(() -> guard.checkOrThrow("  ")).isInstanceOf(RemoteHostRejectedException.class);
    assertThat(calls.get()).isZero();
  }

  @Test
  void hostnameReResolutionMeansEachCallInvokesTheResolverFreshNeverCached() {
    // Legacy Remediation Slice 3 - "re-resolve before each real connection
    // attempt to reduce DNS-rebinding risk": simulate a hostname whose
    // answer changes between two checkOrThrow calls for the exact same
    // host string - the guard must reflect the *second* (current) answer,
    // proving it never cached the first.
    Map<String, InetAddress[]> currentAnswer = new java.util.HashMap<>();
    try {
      currentAnswer.put("rebinding-host", new InetAddress[] {InetAddress.getByName("203.0.113.5")}); // public, allowed
    } catch (UnknownHostException e) {
      throw new AssertionError(e);
    }
    HostResolver rebindingResolver = h -> currentAnswer.get(h);
    RemoteHostGuard guard = guardWith(emptyAllowlist(), rebindingResolver);

    guard.checkOrThrow("rebinding-host"); // first resolution: public, allowed

    try {
      currentAnswer.put("rebinding-host", new InetAddress[] {InetAddress.getByName("127.0.0.1")}); // rebound to loopback
    } catch (UnknownHostException e) {
      throw new AssertionError(e);
    }
    assertThatThrownBy(() -> guard.checkOrThrow("rebinding-host")) // second resolution: must re-check, not reuse the first (allowed) verdict
        .isInstanceOf(RemoteHostRejectedException.class);
  }

  @Test
  void testConnectionAndRuntimeDockerConstructionShareTheExactSamePolicyInstance() {
    // DockerClientFactory holds exactly one RemoteHostGuard, injected once
    // at construction and used by every buildConfig() call regardless of
    // caller (runtime DockerLogSource construction or
    // api.DockerSettingsController's Test Connection) - proven at the
    // wiring level here; DockerSettingsControllerTest proves the
    // controller genuinely goes through this same DockerClientFactory.
    RemoteHostGuard guard = guardWith(emptyAllowlist(), fixedResolver("shared-host", "10.1.1.1"));
    com.logexplorer.source.docker.DockerClientFactory factory = new com.logexplorer.source.docker.DockerClientFactory(guard);

    com.logexplorer.config.DockerProperties runtimeProps = new com.logexplorer.config.DockerProperties();
    runtimeProps.setMode(com.logexplorer.config.DockerProperties.Mode.REMOTE);
    runtimeProps.setHost("shared-host");

    com.logexplorer.config.DockerProperties testConnectionProps = new com.logexplorer.config.DockerProperties();
    testConnectionProps.setMode(com.logexplorer.config.DockerProperties.Mode.REMOTE);
    testConnectionProps.setHost("shared-host");

    // .create() (the public entry point both runtime DockerLogSource
    // construction and api.DockerSettingsController's Test Connection
    // actually call) internally calls buildConfig() first - the guard
    // check happens before any HTTP client is even constructed.
    assertThatThrownBy(() -> factory.create(runtimeProps)).isInstanceOf(RemoteHostRejectedException.class);
    assertThatThrownBy(() -> factory.create(testConnectionProps)).isInstanceOf(RemoteHostRejectedException.class);
  }
}
