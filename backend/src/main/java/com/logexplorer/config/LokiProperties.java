package com.logexplorer.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * {@code logexplorer.loki.*} — every segment of the OpenShift LokiStack
 * gateway path/tenant/labels is configurable here, nothing dangerously
 * hardcoded (IMPLEMENTATION_PLAN.md "Phase D" scope item 1) — different
 * clusters use different gateway prefixes, tenants, and label keys.
 *
 * <p>TLS verification always stays on (never trust-all — CLAUDE.md §2 rule
 * 7); {@code caCertPath} optionally adds one more trusted CA (e.g. an
 * OpenShift cluster's internal CA) on top of the JVM's default trust
 * store, it never replaces or bypasses verification.
 *
 * <p>The bearer token is never held here directly — {@code
 * source.loki.LokiTokenSupplier} reads it fresh from {@code tokenEnvVar}
 * or {@code tokenFilePath} at request time and wraps it in {@code
 * core.model.RawToken}, which redacts itself in {@code toString()}
 * (HANDOVER.md §6.5: "Token from env/secret only, never logged").
 */
@ConfigurationProperties(prefix = "logexplorer.loki")
public class LokiProperties {

  private String baseUrl;
  private String gatewayPrefix = "/api/logs/v1";
  private String tenant = "application";
  private String namespaceLabelKey = "kubernetes_namespace_name";
  private String serviceLabelKey = "app";
  private String podLabelKey = "pod";
  private String containerLabelKey = "container";

  /** Fixed per deployment (this backend is deployed with access to one namespace) - not a per-request field. */
  private String namespace;

  private int maxResultsPerQuery = 2000;
  private Duration requestTimeout = Duration.ofSeconds(15);
  private Duration connectTimeout = Duration.ofSeconds(5);

  private String tokenEnvVar;
  private String tokenFilePath;
  private String caCertPath;

  /** Config-gated: raw LogQL is off by default (Phase E wires actual usage; this just reports the flag honestly). */
  private boolean rawLogQlEnabled = false;

  /** Config-gated: only true if the gateway genuinely supports tail - never faked (HANDOVER.md §18.3). */
  private boolean liveTailSupported = false;

  public String getBaseUrl() {
    return baseUrl;
  }

  public void setBaseUrl(String baseUrl) {
    this.baseUrl = baseUrl;
  }

  public String getGatewayPrefix() {
    return gatewayPrefix;
  }

  public void setGatewayPrefix(String gatewayPrefix) {
    this.gatewayPrefix = gatewayPrefix;
  }

  public String getTenant() {
    return tenant;
  }

  public void setTenant(String tenant) {
    this.tenant = tenant;
  }

  public String getNamespaceLabelKey() {
    return namespaceLabelKey;
  }

  public void setNamespaceLabelKey(String namespaceLabelKey) {
    this.namespaceLabelKey = namespaceLabelKey;
  }

  public String getServiceLabelKey() {
    return serviceLabelKey;
  }

  public void setServiceLabelKey(String serviceLabelKey) {
    this.serviceLabelKey = serviceLabelKey;
  }

  public String getPodLabelKey() {
    return podLabelKey;
  }

  public void setPodLabelKey(String podLabelKey) {
    this.podLabelKey = podLabelKey;
  }

  public String getContainerLabelKey() {
    return containerLabelKey;
  }

  public void setContainerLabelKey(String containerLabelKey) {
    this.containerLabelKey = containerLabelKey;
  }

  public String getNamespace() {
    return namespace;
  }

  public void setNamespace(String namespace) {
    this.namespace = namespace;
  }

  public int getMaxResultsPerQuery() {
    return maxResultsPerQuery;
  }

  public void setMaxResultsPerQuery(int maxResultsPerQuery) {
    this.maxResultsPerQuery = maxResultsPerQuery;
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

  public String getTokenEnvVar() {
    return tokenEnvVar;
  }

  public void setTokenEnvVar(String tokenEnvVar) {
    this.tokenEnvVar = tokenEnvVar;
  }

  public String getTokenFilePath() {
    return tokenFilePath;
  }

  public void setTokenFilePath(String tokenFilePath) {
    this.tokenFilePath = tokenFilePath;
  }

  public String getCaCertPath() {
    return caCertPath;
  }

  public void setCaCertPath(String caCertPath) {
    this.caCertPath = caCertPath;
  }

  public boolean isRawLogQlEnabled() {
    return rawLogQlEnabled;
  }

  public void setRawLogQlEnabled(boolean rawLogQlEnabled) {
    this.rawLogQlEnabled = rawLogQlEnabled;
  }

  public boolean isLiveTailSupported() {
    return liveTailSupported;
  }

  public void setLiveTailSupported(boolean liveTailSupported) {
    this.liveTailSupported = liveTailSupported;
  }
}
