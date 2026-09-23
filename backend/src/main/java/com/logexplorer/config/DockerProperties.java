package com.logexplorer.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * {@code logexplorer.docker.*} — connection mode and bounds for the Docker
 * source (IMPLEMENTATION_PLAN.md "Phase C").
 *
 * <p>{@code LOCAL} mode (the default) delegates to {@code docker-java}'s own
 * default config builder, which honors {@code DOCKER_HOST} and the standard
 * Docker TLS env vars itself (IMPLEMENTATION_PLAN.md "Phase C" scope item
 * 2) — nothing here needs to duplicate that. {@code REMOTE} mode uses the
 * explicit host/port/tls fields below instead: a sensible default port,
 * prefilled and overridable, with TLS as an optional connection mode (never
 * forced, never trust-all — see {@code DockerClientFactory}).
 */
@ConfigurationProperties(prefix = "logexplorer.docker")
public class DockerProperties {

  public enum Mode { LOCAL, REMOTE }

  private Mode mode = Mode.LOCAL;

  /** REMOTE mode only: the remote Docker host, e.g. {@code 192.0.2.10}. */
  private String host;

  /** REMOTE mode only: sensible default, prefilled, always overridable — never hardcoded elsewhere. */
  private int port = 2375;

  /** REMOTE mode only: optional. Never forced on; never trust-all when on. */
  private boolean tls = false;

  /** REMOTE mode + tls=true only: directory containing ca.pem/cert.pem/key.pem. */
  private String tlsCertPath;

  /**
   * UX-R3 §6 — REMOTE mode only: a purely cosmetic display/identity label
   * (e.g. "QA Docker", "Integration Server") for the Settings summary.
   * Never affects connection identity, authorization, or which host/port
   * is actually dialed — {@code DockerClientFactory} never reads this
   * field at all.
   */
  private String connectionName;

  /** Optional: only discover/search containers belonging to this Compose project. */
  private String composeProjectFilter;

  private int maxContainers = 200;
  private int defaultTailLines = 2000;
  private Duration requestTimeout = Duration.ofSeconds(10);
  private Duration connectTimeout = Duration.ofSeconds(5);

  /**
   * Owner mission "Service Filter, Docker Performance, and Verified
   * Default Mapping" §B — the maximum number of target containers read
   * concurrently during a historical search. Bounded (not unbounded)
   * parallelism: latency approaches {@code ceil(containerCount /
   * historicalSearchConcurrency) * perContainerLatency} instead of the
   * previous sequential sum, while never opening more simultaneous Docker
   * API reads than this bound regardless of how many containers match.
   */
  private int historicalSearchConcurrency = 6;

  /**
   * PR65_FRESH_SEARCH_CUSTOM_TIME_AND_BATCH_RECOVERY — the bounded number of
   * progressive per-container read rounds {@code DockerLogSource} will
   * attempt for one search before giving up and honestly reporting a
   * partial/truncated result. Round 1 always reads exactly the same
   * {@code [start, end]} window (narrowed by any page cursor) capped at
   * {@link #defaultTailLines} lines per container that every prior release
   * already did — a container whose whole window fits within that cap
   * needs no further rounds, so this is fully backward-compatible for the
   * common case. Only a container whose round-1 read was itself capped
   * (proof that its window may hold more than {@link #defaultTailLines}
   * lines) gets narrowed further and re-read, up to this many total rounds
   * — the fix for "a selective Search only ever sees the newest {@link
   * #defaultTailLines} raw lines per container, never anything genuinely
   * older within the requested window" (owner mission
   * PR65_FRESH_SEARCH_CUSTOM_TIME_AND_BATCH_RECOVERY, defect 1). Bounded,
   * not unbounded: total Docker reads for one search are at most {@code
   * targetContainerCount * maxHistoricalScanChunks}, each still capped at
   * {@link #defaultTailLines} lines and the configured request timeout.
   */
  private int maxHistoricalScanChunks = 5;

  public Mode getMode() {
    return mode;
  }

  public void setMode(Mode mode) {
    this.mode = mode;
  }

  public String getHost() {
    return host;
  }

  public void setHost(String host) {
    this.host = host;
  }

  public int getPort() {
    return port;
  }

  public void setPort(int port) {
    this.port = port;
  }

  public boolean isTls() {
    return tls;
  }

  public void setTls(boolean tls) {
    this.tls = tls;
  }

  public String getTlsCertPath() {
    return tlsCertPath;
  }

  public void setTlsCertPath(String tlsCertPath) {
    this.tlsCertPath = tlsCertPath;
  }

  public String getConnectionName() {
    return connectionName;
  }

  public void setConnectionName(String connectionName) {
    this.connectionName = connectionName;
  }

  public String getComposeProjectFilter() {
    return composeProjectFilter;
  }

  public void setComposeProjectFilter(String composeProjectFilter) {
    this.composeProjectFilter = composeProjectFilter;
  }

  public int getMaxContainers() {
    return maxContainers;
  }

  public void setMaxContainers(int maxContainers) {
    this.maxContainers = maxContainers;
  }

  public int getDefaultTailLines() {
    return defaultTailLines;
  }

  public void setDefaultTailLines(int defaultTailLines) {
    this.defaultTailLines = defaultTailLines;
  }

  public Duration getRequestTimeout() {
    return requestTimeout;
  }

  public void setRequestTimeout(Duration requestTimeout) {
    this.requestTimeout = requestTimeout;
  }

  public Duration getConnectTimeout() {
    return connectTimeout;
  }

  public void setConnectTimeout(Duration connectTimeout) {
    this.connectTimeout = connectTimeout;
  }

  public int getHistoricalSearchConcurrency() {
    return historicalSearchConcurrency;
  }

  public void setHistoricalSearchConcurrency(int historicalSearchConcurrency) {
    this.historicalSearchConcurrency = historicalSearchConcurrency;
  }

  public int getMaxHistoricalScanChunks() {
    return maxHistoricalScanChunks;
  }

  public void setMaxHistoricalScanChunks(int maxHistoricalScanChunks) {
    this.maxHistoricalScanChunks = maxHistoricalScanChunks;
  }
}
