package com.logexplorer.source.openshift;

import java.util.List;

/**
 * The outcome of one workload-discovery pass over a namespace (OS-1B
 * §7/§17) — one attempt per supported {@link WorkloadKind}, each of which
 * can genuinely fail independently without failing the whole operation.
 *
 * <p>Modelled the same way {@link ProjectDiscovery} deliberately keeps
 * "no projects" and "not allowed to ask" as different values rather than
 * collapsing them: a kind that is genuinely absent from the cluster
 * ({@link KindOutcome.Status#UNAVAILABLE_RESOURCE_TYPE}), a kind the user
 * may not list ({@link KindOutcome.Status#FORBIDDEN}), and a kind that
 * failed for some other real reason ({@link KindOutcome.Status#ERROR})
 * are three different truths, and none of them collapses the whole
 * discovery into a single failure — only {@code 401} does that (it
 * propagates as an {@link OpenShiftApiException}, matching connect/refresh
 * project discovery's existing 401 handling, because an invalid token
 * invalidates every subsequent call regardless of resource kind).
 *
 * @param workloads every workload actually discovered, across every kind
 *     that succeeded — sorted by kind then name (OS-1B §19)
 * @param kindOutcomes exactly one entry per attempted {@link WorkloadKind},
 *     in {@link WorkloadKind}'s declared order
 */
public record WorkloadDiscovery(List<WorkloadSummary> workloads, List<KindOutcome> kindOutcomes) {

  public enum Status {
    /** Every attempted kind succeeded (an empty result is still SUCCESS — genuinely zero workloads). */
    SUCCESS,
    /** At least one kind succeeded and at least one did not. */
    PARTIAL,
    /** Every attempted kind was refused with 403 — nothing could be discovered at all. */
    FORBIDDEN
  }

  /** One kind's own outcome, never inferred from {@link #workloads}'s contents. */
  public record KindOutcome(WorkloadKind kind, Status status) {

    public enum Status {
      AVAILABLE,
      /** A genuine 404 on this kind's own API — the cluster does not expose it (e.g. no DeploymentConfig API). */
      UNAVAILABLE_RESOURCE_TYPE,
      /** A genuine 403 on this kind's own API — the user may not list it. */
      FORBIDDEN,
      /** Any other real failure (429/5xx/network/TLS/proxy/malformed) — never reinterpreted as unavailable. */
      ERROR
    }
  }

  /** Overall status derived from the per-kind outcomes, for a caller that wants one summary value. */
  public Status status() {
    boolean anyAvailable = kindOutcomes.stream().anyMatch(k -> k.status() == KindOutcome.Status.AVAILABLE);
    boolean allForbidden = !kindOutcomes.isEmpty()
        && kindOutcomes.stream().allMatch(k -> k.status() == KindOutcome.Status.FORBIDDEN);
    if (allForbidden) {
      return Status.FORBIDDEN;
    }
    boolean anyNonAvailable = kindOutcomes.stream().anyMatch(k -> k.status() != KindOutcome.Status.AVAILABLE);
    if (anyAvailable && anyNonAvailable) {
      return Status.PARTIAL;
    }
    return Status.SUCCESS;
  }
}
