package com.logexplorer.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * {@code logexplorer.startup.*} — bounds for {@link StartupWarmup}
 * (SEARCH_LATENCY: FIRST_SEARCH_WARMUP_ROOT_CAUSE_AND_OPTIMIZATION).
 * {@code enabled} is an operational safety valve (disable without a code
 * change); {@code iterations} controls how many synthetic events the
 * CPU-pipeline warmup runs through {@code LogLineParser}/{@code
 * EventFilters}/{@code EventMapper} before the server starts accepting
 * connections — see {@link StartupWarmup}'s own javadoc for why this
 * bounded, fixed, synthetic-only pass is safe.
 */
@ConfigurationProperties(prefix = "logexplorer.startup")
public class StartupWarmupProperties {

  private boolean enabled = true;

  /**
   * Enough iterations to reach the JVM's early JIT tiers for the hot
   * parse/filter/mask methods without adding more than a few hundred
   * milliseconds to startup - see
   * docs/performance/FIRST_SEARCH_WARMUP_INVESTIGATION.md "Candidate A+C"
   * for the measured startup-cost-vs-iterations tradeoff this default was
   * chosen from.
   */
  private int iterations = 3000;

  /** Bounded wait for the one-off Docker discovery warmup call (ping + list containers, never log content) - never blocks startup indefinitely if Docker is unreachable/misconfigured. */
  private java.time.Duration dockerWarmupTimeout = java.time.Duration.ofSeconds(3);

  /** Independent toggle from {@link #enabled}/{@link #iterations} - lets the CPU-pipeline warmup and the Docker discovery warmup be measured/disabled independently (SEARCH_LATENCY investigation "test each candidate independently"). */
  private boolean dockerWarmupEnabled = true;

  public boolean isDockerWarmupEnabled() {
    return dockerWarmupEnabled;
  }

  public void setDockerWarmupEnabled(boolean dockerWarmupEnabled) {
    this.dockerWarmupEnabled = dockerWarmupEnabled;
  }

  public boolean isEnabled() {
    return enabled;
  }

  public void setEnabled(boolean enabled) {
    this.enabled = enabled;
  }

  public int getIterations() {
    return iterations;
  }

  public void setIterations(int iterations) {
    this.iterations = iterations;
  }

  public java.time.Duration getDockerWarmupTimeout() {
    return dockerWarmupTimeout;
  }

  public void setDockerWarmupTimeout(java.time.Duration dockerWarmupTimeout) {
    this.dockerWarmupTimeout = dockerWarmupTimeout;
  }
}
