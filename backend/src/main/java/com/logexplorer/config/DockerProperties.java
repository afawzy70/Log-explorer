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
}
