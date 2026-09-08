package com.logexplorer.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * {@code logexplorer.live.*} — bounded live-tail guardrails
 * (IMPLEMENTATION_PLAN.md "Phase J": "connection timeout; max concurrent
 * tails; bounded buffers"). Every limit here is a real enforced ceiling,
 * mirroring {@link SearchGuardrailsProperties}'s own documented intent.
 */
@ConfigurationProperties(prefix = "logexplorer.live")
public class LiveTailProperties {

  private int maxConcurrentTails = 4;
  private Duration connectionTimeout = Duration.ofMinutes(30);
  private Duration heartbeatInterval = Duration.ofSeconds(15);

  /** Bound on the server-side per-connection event buffer before oldest events are dropped (HANDOVER.md §18.4 "bounded buffers; backpressure/dropped notice"). */
  private int serverBufferSize = 500;

  public int getMaxConcurrentTails() {
    return maxConcurrentTails;
  }

  public void setMaxConcurrentTails(int maxConcurrentTails) {
    this.maxConcurrentTails = maxConcurrentTails;
  }

  public Duration getConnectionTimeout() {
    return connectionTimeout;
  }

  public void setConnectionTimeout(Duration connectionTimeout) {
    this.connectionTimeout = connectionTimeout;
  }

  public Duration getHeartbeatInterval() {
    return heartbeatInterval;
  }

  public void setHeartbeatInterval(Duration heartbeatInterval) {
    this.heartbeatInterval = heartbeatInterval;
  }

  public int getServerBufferSize() {
    return serverBufferSize;
  }

  public void setServerBufferSize(int serverBufferSize) {
    this.serverBufferSize = serverBufferSize;
  }
}
