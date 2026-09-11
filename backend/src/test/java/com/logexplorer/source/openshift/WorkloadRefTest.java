package com.logexplorer.source.openshift;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

/**
 * OS-1B §6 - workload identity is a strongly-typed value, never a bare
 * display string, and two workloads of different kinds sharing a name
 * must never be treated as the same reference.
 */
class WorkloadRefTest {

  @Test
  void requiresAKind() {
    assertThatThrownBy(() -> new WorkloadRef(null, "payments", "payments-ns"))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void requiresANonBlankName() {
    assertThatThrownBy(() -> new WorkloadRef(WorkloadKind.DEPLOYMENT, "", "payments-ns"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new WorkloadRef(WorkloadKind.DEPLOYMENT, null, "payments-ns"))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void requiresANonBlankNamespace() {
    assertThatThrownBy(() -> new WorkloadRef(WorkloadKind.DEPLOYMENT, "payments", ""))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void twoDifferentKindsWithTheSameNameAreDifferentReferences() {
    WorkloadRef deployment = new WorkloadRef(WorkloadKind.DEPLOYMENT, "payments", "payments-ns");
    WorkloadRef statefulSet = new WorkloadRef(WorkloadKind.STATEFUL_SET, "payments", "payments-ns");

    assertThat(deployment).isNotEqualTo(statefulSet);
  }

  @Test
  void sameKindNameAndNamespaceAreEqual() {
    WorkloadRef a = new WorkloadRef(WorkloadKind.DEPLOYMENT, "payments", "payments-ns");
    WorkloadRef b = new WorkloadRef(WorkloadKind.DEPLOYMENT, "payments", "payments-ns");

    assertThat(a).isEqualTo(b);
  }
}
