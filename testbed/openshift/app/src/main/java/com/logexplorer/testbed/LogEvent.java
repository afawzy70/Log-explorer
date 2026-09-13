package com.logexplorer.testbed;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;

/**
 * Writes one structured JSON log line directly to stdout - exactly the
 * field shape {@code backend/.../core/parse/LogLineParser.java} and its
 * own {@code FixtureCorpusGenerator} reference already parse/generate
 * (`@timestamp`, `@version`, `message`, `logger_name`, `thread_name`,
 * `level`, `level_value`, `application`, `mdc.*`), so a real OpenShift
 * `oc logs`-captured line from this testbed round-trips through the real
 * product parser identically to the deterministic Fixture source.
 *
 * <p>stdout, not a file: OpenShift/Kubernetes captures container stdout
 * as the pod's own log stream automatically - this is exactly how a real
 * containerized Spring Boot app's structured logs reach `oc logs` /
 * the Kubernetes pod-log API in practice.
 *
 * <p>TEST INFRASTRUCTURE ONLY. No real personal information - every MDC
 * value below is an obviously-fake, deterministic-shaped placeholder.
 */
final class LogEvent {

  private static final ObjectMapper MAPPER = new ObjectMapper();

  private final String service;

  LogEvent(String service) {
    this.service = service;
  }

  void emit(String level, String message, String correlationId, String traceId, String journeyId,
      String errorCode, String stepName, String exception, Map<String, String> extraMdc) {
    Map<String, Object> root = new LinkedHashMap<>();
    root.put("@timestamp", Instant.now().toString());
    root.put("@version", "1");
    root.put("message", message);
    root.put("logger_name", "com.logexplorer.testbed." + service.replace("-", "") + ".App");
    root.put("thread_name", Thread.currentThread().getName());
    root.put("level", level);
    root.put("level_value", levelValue(level));
    root.put("application", service);
    if (exception != null) {
      root.put("exception", exception);
    }

    int i = ThreadLocalRandom.current().nextInt(1_000_000);
    Map<String, Object> mdc = new LinkedHashMap<>();
    mdc.put("traceId", traceId != null ? traceId : "testbed-trace-" + pad(i));
    mdc.put("spanId", "testbed-span-" + pad(i));
    mdc.put("eventId", "testbed-event-" + pad(i));
    mdc.put("x-journey-trace-id", journeyId != null ? journeyId : "testbed-journey-" + pad(i / 7));
    mdc.put("stepName", stepName != null ? stepName : "process-request");
    mdc.put("UIIdentifier", pick("screen.workflow.confirm", "screen.login", "screen.dashboard", "screen.support.ticket"));
    mdc.put("ERROR_CODE", errorCode != null ? errorCode : "ERR_NONE");
    mdc.put("devicePlatformType", pick("ANDROID", "IOS", "WEB"));
    mdc.put("language", pick("en", "ar"));
    mdc.put("serverIp", "172.21." + (i % 10) + "." + ((i * 3) % 255));
    mdc.put("serverHost", System.getenv().getOrDefault("HOSTNAME", "testbed-host"));
    mdc.put("cif", "FAKE-CIF-" + pad(1000 + (i % 900)));
    mdc.put("UserName", "testbed.user" + (i % 37));
    mdc.put("CustomerId", "DEMO-CUST-" + pad(200000 + (i % 5000)));
    mdc.put("deviceId", "DEMO-DEVICE-" + pad(i % 999));
    mdc.put("deviceIp", "10." + (i % 200) + "." + ((i * 7) % 200) + "." + ((i * 13) % 255));
    if (correlationId != null) {
      // Alternates which of the two correlation-precedence keys is used,
      // deterministically per event id, so both variants get real
      // exercise across a long-running testbed - matching
      // FixtureCorpusGenerator's own "both variants guaranteed" intent.
      if (i % 2 == 0) {
        mdc.put("X-Correlation-id", correlationId);
      } else {
        mdc.put("event.correlationId", correlationId);
      }
    }
    if (extraMdc != null) {
      mdc.putAll(extraMdc);
    }
    root.put("mdc", mdc);

    try {
      System.out.println(MAPPER.writeValueAsString(root));
    } catch (Exception e) {
      // A log line must never crash the app that emits it.
      System.out.println("{\"level\":\"ERROR\",\"message\":\"testbed log serialization failed\"}");
    }
  }

  private static int levelValue(String level) {
    return switch (level) {
      case "ERROR" -> 40000;
      case "WARN" -> 30000;
      case "DEBUG" -> 10000;
      default -> 20000;
    };
  }

  private static String pad(int n) {
    return String.format("%06d", Math.abs(n) % 1_000_000);
  }

  private static String pick(String... options) {
    return options[ThreadLocalRandom.current().nextInt(options.length)];
  }
}
