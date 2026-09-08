package com.logexplorer.config;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * {@code logexplorer.search.*} — bounded-search guardrails
 * (IMPLEMENTATION_PLAN.md "Phase B" item 10). Every limit here is a real
 * enforced ceiling, not documentation.
 */
@ConfigurationProperties(prefix = "logexplorer.search")
public class SearchGuardrailsProperties {

  private int defaultLimit = 200;

  /** Hard ceiling. HANDOVER.md §8.1: "initial design capped request max at &lt;= 5000". */
  private int maxLimit = 5000;

  private Duration maxTimeRange = Duration.ofDays(7);

  /** Per-source override, keyed by source id; falls back to {@link #maxTimeRange}. */
  private Map<String, Duration> perSourceMaxTimeRange = new HashMap<>();

  private Duration requestTimeout = Duration.ofSeconds(30);

  private int maxConcurrency = 8;

  public int getDefaultLimit() {
    return defaultLimit;
  }

  public void setDefaultLimit(int defaultLimit) {
    this.defaultLimit = defaultLimit;
  }

  public int getMaxLimit() {
    return maxLimit;
  }

  public void setMaxLimit(int maxLimit) {
    this.maxLimit = maxLimit;
  }

  public Duration getMaxTimeRange() {
    return maxTimeRange;
  }

  public void setMaxTimeRange(Duration maxTimeRange) {
    this.maxTimeRange = maxTimeRange;
  }

  public Map<String, Duration> getPerSourceMaxTimeRange() {
    return perSourceMaxTimeRange;
  }

  public void setPerSourceMaxTimeRange(Map<String, Duration> perSourceMaxTimeRange) {
    this.perSourceMaxTimeRange = perSourceMaxTimeRange;
  }

  public Duration getRequestTimeout() {
    return requestTimeout;
  }

  public void setRequestTimeout(Duration requestTimeout) {
    this.requestTimeout = requestTimeout;
  }

  public int getMaxConcurrency() {
    return maxConcurrency;
  }

  public void setMaxConcurrency(int maxConcurrency) {
    this.maxConcurrency = maxConcurrency;
  }
}
