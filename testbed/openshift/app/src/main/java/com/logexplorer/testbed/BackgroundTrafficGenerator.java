package com.logexplorer.testbed;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Mission §7.I/§7.J, §8 - slow, continuous, bounded background traffic
 * (one event every few seconds per pod), so Live has something real to
 * show without an investigator needing to trigger every event by hand,
 * and so interleaved, unrelated correlationIds are naturally present
 * (mission §7.I) alongside whatever explicit `/test/*` scenario an
 * investigator triggers. Deliberately modest: across ~12 pods at this
 * rate, aggregate volume stays well within Sandbox-friendly bounds -
 * never an "accidental infinite high-volume logger" (mission §8).
 */
@Component
class BackgroundTrafficGenerator {

  private final ServiceIdentity identity;
  private final LogEvent log;

  BackgroundTrafficGenerator(ServiceIdentity identity) {
    this.identity = identity;
    this.log = new LogEvent(identity.serviceName);
  }

  @Scheduled(fixedDelayString = "${TESTBED_BACKGROUND_INTERVAL_MS:4000}")
  void emitOne() {
    int roll = ThreadLocalRandom.current().nextInt(100);
    String correlationId = "corr-bg-" + UUID.randomUUID();
    String traceId = "trace-bg-" + UUID.randomUUID();

    if (roll < 3) {
      // Mission §7.F - an occasional empty-message event.
      log.emit("INFO", "", correlationId, traceId, null, "ERR_NONE", "background-task", null, null);
    } else if (roll < 8) {
      // Mission §7.E - an occasional slow-operation warning.
      log.emit("WARN", "Slow operation detected - exceeded expected latency budget", correlationId, traceId, null,
          "ERR_TIMEOUT", "background-task", null,
          Map.of("latencyMs", String.valueOf(1500 + ThreadLocalRandom.current().nextInt(3500))));
    } else if (roll < 10) {
      // A rare, genuine background error, distinct from the explicit /test/payment-error scenario.
      log.emit("ERROR", "Background task failed unexpectedly", correlationId, traceId, null, "ERR_UPSTREAM_5XX",
          "background-task", null, null);
    } else {
      log.emit("INFO", backgroundMessage(), correlationId, traceId, null, "ERR_NONE", "background-task", null, null);
    }
  }

  private String backgroundMessage() {
    return switch (identity.serviceRole) {
      case "GATEWAY" -> "Health check probe served";
      case "CUSTOMERS" -> "Refreshed customer profile cache entry";
      case "ACCOUNTS" -> "Reconciled account balance snapshot";
      case "PAYMENTS" -> "Polled payment gateway status";
      case "TRANSFERS" -> "Checked pending transfer queue";
      case "BENEFICIARIES" -> "Synced beneficiary directory entry";
      case "NOTIFICATIONS" -> "Drained notification delivery queue";
      case "FRAUD" -> "Updated fraud model risk cache";
      case "AUDIT" -> "Flushed audit log buffer";
      case "STATEMENTS" -> "Rotated statement generation batch";
      default -> "Background heartbeat";
    };
  }
}
