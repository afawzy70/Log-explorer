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
}
