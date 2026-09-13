package com.logexplorer.testbed;

import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** A plain liveness/readiness endpoint - no Actuator dependency needed for a throwaway testbed image. */
@RestController
class HealthController {

  private final ServiceIdentity identity;

  HealthController(ServiceIdentity identity) {
    this.identity = identity;
  }

  @GetMapping("/healthz")
  Map<String, String> health() {
    return Map.of("status", "UP", "service", identity.serviceName, "role", identity.serviceRole);
  }
}
