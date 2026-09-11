package com.logexplorer.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * {@code logexplorer.openshift.direct-search.*} — bounded-fan-out and
 * per-stream limits for OS-1C direct OpenShift log search (OS-1C §7).
 *
 * <p>Every limit here is a real enforced ceiling, not documentation —
 * mirrors {@code DockerProperties}' own {@code maxContainers}/{@code
 * defaultTailLines}/{@code requestTimeout} bounds, one layer deeper
 * (per-pod-per-container target, not just per-container) because a single
 * OpenShift namespace can genuinely host far more pods than a Compose
 * project has containers, and each pod-log fetch is a real network round
 * trip rather than a local Docker socket call.
 */
@ConfigurationProperties(prefix = "logexplorer.openshift.direct-search")
public class DirectPodLogProperties {

  /** Hard cap on distinct pods considered for one search, after OS-1B scope resolution. */
  private int maxPods = 20;

  /** Hard cap on distinct (pod, container) targets actually queried — the real fan-out bound. */
  private int maxTargets = 40;

  /** Per-target upstream read cap — bounded by {@code tailLines} on the pod-log request itself. */
  private int maxLinesPerTarget = 2000;

  /** Per-target hard byte cap on the read response body, enforced client-side regardless of upstream size. */
  private long maxBytesPerTarget = 2_000_000L; // 2 MB

  /** Hard cap on the total number of events this source ever returns from one search, across every target. */
  private int maxEventsOverall = 2000;

  /** Bounded concurrency for the per-target fan-out (OS-1C §9) — never one unbounded request per target. */
  private int maxConcurrency = 6;

  /** Per-target upstream call timeout — one slow pod must not stall the others. */
  private Duration perTargetTimeout = Duration.ofSeconds(10);

  /**
   * Hard backstop for the whole fan-out-and-merge operation, deliberately
   * shorter than {@code logexplorer.search.request-timeout}'s global
   * default (30s) so a runaway OpenShift search fails predictably on its
   * own bound rather than always riding the generic ceiling.
   */
  private Duration overallTimeout = Duration.ofSeconds(20);

  public int getMaxPods() {
    return maxPods;
  }

  public void setMaxPods(int maxPods) {
    this.maxPods = maxPods;
  }

  public int getMaxTargets() {
    return maxTargets;
  }

  public void setMaxTargets(int maxTargets) {
    this.maxTargets = maxTargets;
  }

  public int getMaxLinesPerTarget() {
    return maxLinesPerTarget;
  }

  public void setMaxLinesPerTarget(int maxLinesPerTarget) {
    this.maxLinesPerTarget = maxLinesPerTarget;
  }

  public long getMaxBytesPerTarget() {
    return maxBytesPerTarget;
  }

  public void setMaxBytesPerTarget(long maxBytesPerTarget) {
    this.maxBytesPerTarget = maxBytesPerTarget;
  }

  public int getMaxEventsOverall() {
    return maxEventsOverall;
  }

  public void setMaxEventsOverall(int maxEventsOverall) {
    this.maxEventsOverall = maxEventsOverall;
  }

  public int getMaxConcurrency() {
    return maxConcurrency;
  }

  public void setMaxConcurrency(int maxConcurrency) {
    this.maxConcurrency = maxConcurrency;
  }

  public Duration getPerTargetTimeout() {
    return perTargetTimeout;
  }

  public void setPerTargetTimeout(Duration perTargetTimeout) {
    this.perTargetTimeout = perTargetTimeout;
  }

  public Duration getOverallTimeout() {
    return overallTimeout;
  }

  public void setOverallTimeout(Duration overallTimeout) {
    this.overallTimeout = overallTimeout;
  }
}
