package com.logexplorer.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * {@code logexplorer.openshift.live.*} — bounds specific to OS-1E live
 * tail that OS-1C's own {@link DirectPodLogProperties} has no equivalent
 * for (a bounded historical search never reconnects or streams an
 * unbounded body). {@code maxPods}/{@code maxTargets}/{@code
 * maxConcurrency} are deliberately NOT duplicated here — OS-1E reuses
 * {@link DirectPodLogProperties}'s own fields for those (mission's own
 * "reuse OS-1C bounds where semantically appropriate"), since the target-
 * resolution/fan-out bound is the same concern for search and live alike.
 */
@ConfigurationProperties(prefix = "logexplorer.openshift.live")
public class OpenShiftLiveProperties {

  /**
   * {@code tailLines} on the initial {@code follow=true} request — small
   * and bounded so clicking Live never accidentally replays a large slice
   * of history (mission §14). The lines this returns are historical
   * (received before the connection was established), not proof that an
   * event happened after Live started - documented, never disguised as
   * newly-arriving.
   */
  private int initialTailLines = 5;

  /**
   * Hard cap on one buffered-but-not-yet-newline-terminated logical line,
   * enforced by the streaming line decoder itself (never by first reading
   * the whole body) - the safety valve for a pathological stream that
   * never emits a `\n` at all, so memory stays bounded regardless of
   * upstream behavior.
   */
  private int maxLineBytes = 65_536; // 64 KB

  /** Hard cap on reconnect attempts for one (pod, container) target's own follow stream, after a transient failure. */
  private int maxReconnectAttempts = 5;

  /** First reconnect delay for one target's own stream - exponential backoff from here, capped at {@link #maxReconnectDelay}. */
  private Duration initialReconnectDelay = Duration.ofSeconds(1);

  /** Hard ceiling every per-target reconnect backoff is capped at. */
  private Duration maxReconnectDelay = Duration.ofSeconds(30);

  /**
   * OS-1E review recovery — bounds how many of one live session's own
   * targets may simultaneously be in the "opening/reconnecting" admission
   * phase (see {@code OpenShiftLiveTailProvider}'s own "connect permit"
   * javadoc for the full rationale) - a target's admission permit is
   * released as soon as its first line/error/completion arrives, OR after
   * this timeout elapses, whichever comes first, so a connection that is
   * genuinely established but simply has no new data yet never holds its
   * permit forever and starves later targets.
   */
  private Duration connectPermitTimeout = Duration.ofSeconds(3);

  /**
   * OS-1E review recovery — how often one live session checks, from
   * already-in-memory {@code OpenShiftSession} state only (never a
   * cluster/network call), whether the connection generation or the
   * selected project/workload/pod/container it captured at start is still
   * current. A mismatch marks the session {@code STALE} and stops it -
   * see mission §16/§17.
   */
  private Duration stalenessCheckInterval = Duration.ofSeconds(5);

  public int getInitialTailLines() {
    return initialTailLines;
  }

  public void setInitialTailLines(int initialTailLines) {
    this.initialTailLines = initialTailLines;
  }

  public int getMaxLineBytes() {
    return maxLineBytes;
  }

  public void setMaxLineBytes(int maxLineBytes) {
    this.maxLineBytes = maxLineBytes;
  }

  public int getMaxReconnectAttempts() {
    return maxReconnectAttempts;
  }

  public void setMaxReconnectAttempts(int maxReconnectAttempts) {
    this.maxReconnectAttempts = maxReconnectAttempts;
  }

  public Duration getInitialReconnectDelay() {
    return initialReconnectDelay;
  }

  public void setInitialReconnectDelay(Duration initialReconnectDelay) {
    this.initialReconnectDelay = initialReconnectDelay;
  }

  public Duration getMaxReconnectDelay() {
    return maxReconnectDelay;
  }

  public void setMaxReconnectDelay(Duration maxReconnectDelay) {
    this.maxReconnectDelay = maxReconnectDelay;
  }

  public Duration getConnectPermitTimeout() {
    return connectPermitTimeout;
  }

  public void setConnectPermitTimeout(Duration connectPermitTimeout) {
    this.connectPermitTimeout = connectPermitTimeout;
  }

  public Duration getStalenessCheckInterval() {
    return stalenessCheckInterval;
  }

  public void setStalenessCheckInterval(Duration stalenessCheckInterval) {
    this.stalenessCheckInterval = stalenessCheckInterval;
  }
}
