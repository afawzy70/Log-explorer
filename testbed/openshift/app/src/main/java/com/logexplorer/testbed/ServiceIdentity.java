package com.logexplorer.testbed;

import java.util.List;
import org.springframework.stereotype.Component;

/**
 * This pod's own identity, taken from environment variables set per
 * Deployment (never hardcoded, never baked into the shared image) - the
 * one thing that differentiates otherwise-identical replicas of the same
 * jar into ~10 logically distinct OpenShift workloads.
 */
@Component
class ServiceIdentity {

  /** The "normal successful request flow" chain (mission §7.A/§7.H) - shared by every instance of the same image, walked by service name at runtime. */
  static final List<String> JOURNEY_CHAIN = List.of(
      "gateway-service", "customer-service", "account-service", "payment-service",
      "notification-service", "audit-service");

  final String serviceName;
  final String serviceRole;

  ServiceIdentity() {
    this.serviceName = System.getenv().getOrDefault("SERVICE_NAME", "unknown-service");
    this.serviceRole = System.getenv().getOrDefault("SERVICE_ROLE", "UNKNOWN");
  }

  /** The next hop in {@link #JOURNEY_CHAIN} after this service, or {@code null} at (or past) the end. */
  String nextInJourney() {
    int index = JOURNEY_CHAIN.indexOf(serviceName);
    if (index < 0 || index + 1 >= JOURNEY_CHAIN.size()) {
      return null;
    }
    return JOURNEY_CHAIN.get(index + 1);
  }
}
