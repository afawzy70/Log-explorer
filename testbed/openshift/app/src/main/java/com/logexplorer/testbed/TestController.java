package com.logexplorer.testbed;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClient;

/**
 * OS-1F real-Sandbox testbed - deterministic, on-demand investigation
 * scenarios (mission §7/§8), each returning immediately with a
 * `correlationId` the caller can then search/correlate on in the real
 * Log Explorer UI. All bounded - {@link #burst} is the only
 * higher-volume endpoint and is capped. Every scenario/message here is
 * deliberately generic test terminology, never a banking/business-domain
 * name.
 */
@RestController
@RequestMapping("/test")
class TestController {

  private static final int BURST_MAX = 50;

  private final ServiceIdentity identity;
  private final LogEvent log;
  private final RestClient restClient = RestClient.create();

  TestController(ServiceIdentity identity) {
    this.identity = identity;
    this.log = new LogEvent(identity.serviceName);
  }

  /** Mission §7.A/§7.H - starts a normal successful request flow, walking {@link ServiceIdentity#JOURNEY_CHAIN} via real HTTP calls to the next service's own pod, exactly like a genuine distributed request. */
  @PostMapping("/journey")
  ResponseEntity<Map<String, String>> journey() {
    String correlationId = "corr-" + UUID.randomUUID();
    String traceId = "trace-" + UUID.randomUUID();
    String journeyId = "journey-" + UUID.randomUUID();
    journeyStep(correlationId, traceId, journeyId, "OK");
    return ResponseEntity.ok(Map.of("correlationId", correlationId, "traceId", traceId, "journeyId", journeyId));
  }

  /**
   * Internal chain-forwarding hop - never called directly by an
   * investigator, only by the previous service in {@link
   * ServiceIdentity#JOURNEY_CHAIN}. `outcome=NOT_FOUND` implements
   * mission §7.C (profile-not-found) by having `logexp-test-profile` log
   * a WARN and terminate the chain early rather than forwarding it.
   */
  @PostMapping("/journey-step")
  ResponseEntity<Void> journeyStep(
      @RequestParam String correlationId, @RequestParam String traceId, @RequestParam String journeyId,
      @RequestParam(defaultValue = "OK") String outcome) {
    if ("logexp-test-profile".equals(identity.serviceName) && "NOT_FOUND".equals(outcome)) {
      log.emit("WARN", "Profile lookup returned no match for the requested identifier", correlationId, traceId,
          journeyId, "ERR_VALIDATION", "lookup-profile", null, null);
      return ResponseEntity.ok().build(); // chain terminates here - a real "not found" ends the request
    }
    log.emit("INFO", stepMessage(), correlationId, traceId, journeyId, "ERR_NONE", stepName(), null, null);

    String next = identity.nextInJourney();
    if (next != null) {
      forward(next, correlationId, traceId, journeyId, "OK");
    }
    return ResponseEntity.ok().build();
  }

  /** Mission §7.C - a profile-not-found flow, entered fresh (not via the general journey entry point). */
  @PostMapping("/profile-not-found")
  ResponseEntity<Map<String, String>> profileNotFound() {
    String correlationId = "corr-" + UUID.randomUUID();
    String traceId = "trace-" + UUID.randomUUID();
    String journeyId = "journey-" + UUID.randomUUID();
    log.emit("INFO", "Edge accepted profile lookup request", correlationId, traceId, journeyId, "ERR_NONE",
        "route-request", null, null);
    forward("logexp-test-profile", correlationId, traceId, journeyId, "NOT_FOUND");
    return ResponseEntity.ok(Map.of("correlationId", correlationId));
  }

  /** Mission §7.B - a failed order: `logexp-test-orders` emits `ERROR_CODE=ORDER_001` with a real multiline exception, then still sends a delivery message (a realistic failure still produces a downstream side effect). */
  @PostMapping("/order-error")
  ResponseEntity<Map<String, String>> orderError() {
    String correlationId = "corr-" + UUID.randomUUID();
    String traceId = "trace-" + UUID.randomUUID();
    String journeyId = "journey-" + UUID.randomUUID();
    String exception = String.join("\n",
        "java.lang.IllegalStateException: testbed upstream order processing failure",
        "\tat com.logexplorer.testbed.logexptestorders.App.processOrder(App.java:"
            + (40 + ThreadLocalRandom.current().nextInt(60)) + ")",
        "Caused by: java.util.concurrent.TimeoutException: testbed processor timeout after 3000ms",
        "\t... 8 more");
    log.emit("ERROR", "Order processing failed for the requested transaction", correlationId, traceId, journeyId,
        "ORDER_001", "process-order", exception, null);
    forward("logexp-test-message", correlationId, traceId, journeyId, "ORDER_FAILED");
    return ResponseEntity.ok(Map.of("correlationId", correlationId));
  }

  /** Mission §7.D - a rules/policy warning, independent of the main journey chain. */
  @PostMapping("/rules-warning")
  ResponseEntity<Map<String, String>> rulesWarning() {
    String correlationId = "corr-" + UUID.randomUUID();
    String traceId = "trace-" + UUID.randomUUID();
    log.emit("WARN", "Transaction flagged for manual rules review - velocity threshold exceeded", correlationId,
        traceId, null, "ERR_VALIDATION", "evaluate-rules", null,
        Map.of("policyScore", String.valueOf(70 + ThreadLocalRandom.current().nextInt(30))));
    return ResponseEntity.ok(Map.of("correlationId", correlationId));
  }

  /** Mission §7.A - a normal, isolated success event (no chain), for services outside the main journey. */
  @PostMapping("/success")
  ResponseEntity<Map<String, String>> success() {
    String correlationId = "corr-" + UUID.randomUUID();
    log.emit("INFO", stepMessage(), correlationId, "trace-" + UUID.randomUUID(), null, "ERR_NONE", stepName(), null,
        null);
    return ResponseEntity.ok(Map.of("correlationId", correlationId));
  }

  /** Mission §7.J/§8 - a bounded burst, never unbounded (CLAUDE.md §4 "no unbounded scans/buffers"). */
  @PostMapping("/burst")
  ResponseEntity<Map<String, Object>> burst(@RequestParam(defaultValue = "20") int count) {
    int bounded = Math.max(1, Math.min(count, BURST_MAX));
    for (int i = 0; i < bounded; i++) {
      log.emit("INFO", "[burst] " + stepMessage(), "corr-" + UUID.randomUUID(), "trace-" + UUID.randomUUID(), null,
          "ERR_NONE", stepName(), null, null);
    }
    return ResponseEntity.ok(Map.of("emitted", bounded, "max", BURST_MAX));
  }

  /** Mission §7.G - an event carrying an unexpected MDC key, so field preservation can be verified. */
  @PostMapping("/unknown-field")
  ResponseEntity<Void> unknownField() {
    Map<String, String> extra = new HashMap<>();
    extra.put("testbedUnknownField", "this-key-is-not-in-the-canonical-mdc-list");
    log.emit("INFO", "Event carrying an additional, non-canonical field", "corr-" + UUID.randomUUID(),
        "trace-" + UUID.randomUUID(), null, "ERR_NONE", stepName(), null, extra);
    return ResponseEntity.ok().build();
  }

  /** Mission §7.F - an empty-message event. */
  @PostMapping("/empty-message")
  ResponseEntity<Void> emptyMessage() {
    log.emit("INFO", "", "corr-" + UUID.randomUUID(), "trace-" + UUID.randomUUID(), null, "ERR_NONE", stepName(),
        null, null);
    return ResponseEntity.ok().build();
  }

  private void forward(String targetService, String correlationId, String traceId, String journeyId,
      String outcome) {
    try {
      restClient.post()
          .uri("http://{svc}:8080/test/journey-step?correlationId={c}&traceId={t}&journeyId={j}&outcome={o}",
              targetService, correlationId, traceId, journeyId, outcome)
          .retrieve()
          .toBodilessEntity();
    } catch (Exception e) {
      // A downstream hop being unreachable is itself realistic testbed
      // signal (mission §23 "one unavailable target"), not a crash - log
      // it truthfully and stop forwarding rather than throwing.
      log.emit("WARN", "Could not reach downstream service " + targetService + " to continue the journey",
          correlationId, traceId, journeyId, "ERR_UPSTREAM_5XX", "forward-journey", null, null);
    }
  }

  private String stepMessage() {
    return switch (identity.serviceRole) {
      case "EDGE" -> "Routed request to downstream service";
      case "PROFILE" -> "Loaded profile record";
      case "CATALOG" -> "Loaded catalog record";
      case "ORDERS" -> "Processed order transaction";
      case "WORKFLOW" -> "Executed workflow step";
      case "DIRECTORY" -> "Validated directory entry";
      case "MESSAGE" -> "Dispatched message delivery";
      case "RULES" -> "Completed rules evaluation";
      case "ACTIVITY" -> "Recorded activity trail entry";
      case "REPORT" -> "Generated report extract";
      default -> "Handled request";
    };
  }

  private String stepName() {
    return switch (identity.serviceRole) {
      case "EDGE" -> "route-request";
      case "PROFILE" -> "load-profile";
      case "CATALOG" -> "load-catalog";
      case "ORDERS" -> "process-order";
      case "WORKFLOW" -> "execute-workflow";
      case "DIRECTORY" -> "validate-directory";
      case "MESSAGE" -> "deliver-message";
      case "RULES" -> "evaluate-rules";
      case "ACTIVITY" -> "record-activity";
      case "REPORT" -> "generate-report";
      default -> "process-request";
    };
  }
}
