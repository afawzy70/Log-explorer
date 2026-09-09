package com.logexplorer.source.docker;

import java.util.Map;

/**
 * {@code com.docker.compose.*} label access (IMPLEMENTATION_PLAN.md "Phase
 * C" scope item 3). A container is only ever discovered/searched if it
 * carries the project label — this is deliberately the same signal Compose
 * itself uses, so nothing here has to guess what "belongs to this stack"
 * means.
 */
public final class ComposeLabels {

  public static final String PROJECT = "com.docker.compose.project";
  public static final String SERVICE = "com.docker.compose.service";

  /**
   * Self-exclusion (Legacy Remediation Slice 3,
   * {@code docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md} §"Slice 3") — an
   * explicit opt-out label, never a container-name heuristic (a name is
   * user/Compose-chosen and not a reliable identity signal). A container
   * carrying {@code logexplorer.excluded=true} is treated by {@link
   * com.logexplorer.source.docker.DockerLogSource} as if it did not exist
   * at all: absent from service discovery, historical search, and live
   * tail alike, regardless of Compose project filtering. Set on Log
   * Explorer's own `app` service in {@code docker-compose.yml} so it never
   * discovers/reads its own logs when deployed via the portable Compose
   * path — see that file's own comment for the exact label value.
   */
  public static final String EXCLUDED = "logexplorer.excluded";

  private ComposeLabels() {
  }

  public static String project(Map<String, String> labels) {
    return labels == null ? null : labels.get(PROJECT);
  }

  public static String service(Map<String, String> labels) {
    return labels == null ? null : labels.get(SERVICE);
  }

  public static boolean isComposeManaged(Map<String, String> labels) {
    return project(labels) != null;
  }

  /** {@code true} only for the exact case-insensitive value {@code "true"} — any other/missing value means "not excluded," never inferred. */
  public static boolean isExcluded(Map<String, String> labels) {
    return labels != null && "true".equalsIgnoreCase(labels.get(EXCLUDED));
  }
}
