package com.logexplorer.source.openshift;

/**
 * Strongly-typed workload identity (OS-1B §6) — never a display string.
 * Two workloads with the same name but different {@link WorkloadKind} (a
 * Deployment and a StatefulSet both called {@code payments}, which the
 * Kubernetes API allows since they are different resource types) must
 * never be confused with each other, which a bare name/string pair would
 * risk.
 */
public record WorkloadRef(WorkloadKind kind, String name, String namespace) {

  public WorkloadRef {
    if (kind == null) {
      throw new IllegalArgumentException("A workload reference requires a kind.");
    }
    if (name == null || name.isBlank()) {
      throw new IllegalArgumentException("A workload reference requires a name.");
    }
    if (namespace == null || namespace.isBlank()) {
      throw new IllegalArgumentException("A workload reference requires a namespace.");
    }
  }
}
