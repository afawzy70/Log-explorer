package com.logexplorer.source.fixture;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

/**
 * Deterministic raw-log-line generator for H3 (Phase A2b), backed by the
 * same corpus shape as A2a's demo log generator ({@code
 * tools/demo-log-generator/generate.js}) — same four fake services, same
 * required edge cases (both correlation-precedence key variants, a
 * multi-service/multi-trace journey, obviously-fake sensitive values, a
 * multiline exception, an empty message, a malformed line, an unknown MDC
 * field, a burst) guaranteed at a fixed position in each 40-record cycle,
 * not left to chance.
 *
 * <p>Produces raw JSON text, not {@code CanonicalLogEvent} directly, so
 * {@link FixtureLogSource} can feed it through the real {@code
 * LogLineParser} — proving the fixture source and the parser agree on
 * shape, the same way a real adapter would.
 */
public class FixtureCorpusGenerator {

  private static final List<String> SERVICES = List.of(
      "gateway", "accounts-api", "payments-api", "notification-worker");
  private static final int CYCLE_LEN = 40;
  private static final int BURST_SIZE = 6;

  private final ObjectMapper objectMapper;

  public FixtureCorpusGenerator(ObjectMapper objectMapper) {
    this.objectMapper = objectMapper;
  }

  /**
   * @param anchor the timestamp the most recent event should carry;
   *     earlier events are spaced backward from it, so a caller searching
   *     "the last N minutes" from real wall-clock time actually finds them.
   */
  /**
   * One live-tail line (IMPLEMENTATION_PLAN.md "Phase J") - deterministic
   * for a given {@code (seed, globalIndex)}, restamped to {@code
   * timestamp}. Recomputes at most one {@value #CYCLE_LEN}-record cycle,
   * never the whole growing history {@link #generateLines} would need to
   * reproduce the exact same position - a long-running live session calls
   * this once per new event, so its cost must stay flat over time, not
   * grow with how long the tail has been running (CLAUDE.md §4 "no
   * unbounded scans"). Content is fixture-shaped and realistic but not
   * byte-identical to what {@link #generateLines} would put at the same
   * slot, since each cycle here is seeded independently rather than
   * carrying forward one shared {@link Random}'s accumulated state -
   * live tail is a separate, forward-continuing stream, not required to
   * replay the static corpus.
   */
  public String generateLiveLine(long seed, int globalIndex, Instant timestamp) {
    int cycleIndex = globalIndex / CYCLE_LEN;
    int slot = globalIndex % CYCLE_LEN;
    Random rng = new Random(seed + cycleIndex);
    String line = buildCycle(rng, cycleIndex).get(slot);
    return restamp(line, timestamp);
  }

  public List<String> generateLines(long seed, int count, Instant anchor) {
    Random rng = new Random(seed);
    List<String> lines = new ArrayList<>(count);
    int cycleIndex = 0;
    while (lines.size() < count) {
      lines.addAll(buildCycle(rng, cycleIndex));
      cycleIndex++;
    }
    List<String> bounded = lines.size() > count ? lines.subList(0, count) : lines;
    // Space events backward from `anchor` in generation order (index 0 = oldest).
    List<String> restamped = new ArrayList<>(bounded.size());
    for (int i = 0; i < bounded.size(); i++) {
      long secondsBeforeAnchor = (long) (bounded.size() - 1 - i);
      restamped.add(restamp(bounded.get(i), anchor.minusSeconds(secondsBeforeAnchor)));
    }
    return restamped;
  }

  private String restamp(String line, Instant ts) {
    if (!line.startsWith("{")) {
      return line; // malformed line - leave as-is, it has no @timestamp to rewrite
    }
    try {
      @SuppressWarnings("unchecked")
      Map<String, Object> parsed = objectMapper.readValue(line, Map.class);
      parsed.put("@timestamp", ts.toString());
      return objectMapper.writeValueAsString(parsed);
    } catch (Exception e) {
      return line;
    }
  }

  private enum CorrelationVariant { NONE, HEADER, LITERAL }

  private List<String> buildCycle(Random rng, int cycleIndex) {
    List<String> records = new ArrayList<>(CYCLE_LEN);
    int base = cycleIndex * CYCLE_LEN;

    // Slot 0: correlation via X-Correlation-id header variant.
    records.add(event(rng, base, SERVICES.get(0), null, null, CorrelationVariant.HEADER, false,
        null, null, "Applied rate limit check"));

    // Slot 1: correlation via the literal dotted key mdc["event.correlationId"].
    records.add(event(rng, base + 1, SERVICES.get(1), null, null, CorrelationVariant.LITERAL, false,
        null, null, "Loaded account summary"));

    // Slots 2-4: a journey spanning three services and two distinct traceIds.
    String journey = "fixture-journey-" + pad(1000 + cycleIndex, 4);
    String traceA = "fixture-trace-" + pad(base + 100, 6);
    String traceB = "fixture-trace-" + pad(base + 101, 6);
    records.add(event(rng, base + 2, "gateway", journey, traceA, CorrelationVariant.HEADER, false,
        null, null, "Journey step 1: gateway accepted transfer request"));
    records.add(event(rng, base + 3, "accounts-api", journey, traceA, CorrelationVariant.HEADER, false,
        null, null, "Journey step 2: accounts-api validated balance"));
    records.add(event(rng, base + 4, "payments-api", journey, traceB, CorrelationVariant.LITERAL, false,
        null, null, "Journey step 3: payments-api settled transfer under a new trace"));

    // Slot 5: sensitive-fields event (values already fake by construction).
    records.add(event(rng, base + 5, "accounts-api", null, null, CorrelationVariant.HEADER, false,
        null, null, "Customer profile lookup completed"));

    // Slot 6: multiline exception - stays one logical event.
    records.add(event(rng, base + 6, "payments-api", null, null, CorrelationVariant.HEADER, false,
        "ERROR", multilineException("payments-api", rng), "Payment authorization failed"));

    // Slot 7: empty message - preserved, never fabricated.
    records.add(event(rng, base + 7, "gateway", null, null, CorrelationVariant.HEADER, false,
        null, null, ""));

    // Slot 8: malformed / non-JSON line.
    records.add("NOT-JSON fixture-malformed-line service=" + SERVICES.get(base % SERVICES.size())
        + " cycle=" + cycleIndex);

    // Slot 9: unknown MDC field not in the canonical list.
    records.add(event(rng, base + 9, "notification-worker", null, null, CorrelationVariant.HEADER, true,
        null, null, "Notification worker processed unrecognized event shape"));

    // Slot 10: Legacy Remediation Slice 7 - free-text sensitive-data
    // redaction fixture, guaranteed at a fixed position every cycle so a
    // real browser E2E test can verify real server-side redaction against
    // the real running app (StubLogSource, the injection path the backend
    // leak tests use, is not reachable from the browser). Combines several
    // high-confidence redactable patterns in one event (customerId, a
    // valid-Luhn card with spaces, a labeled password, a Bearer JWT in the
    // exception text) plus one deliberately Luhn-INVALID 16-digit
    // "referenceNumber" that must remain visible - both are load-bearing
    // for `phase-legacy-slice7-redaction.spec.ts`.
    records.add(event(rng, base + 10, "accounts-api", null, null, CorrelationVariant.HEADER, false,
        "ERROR",
        "com.logexplorer.fixture.accountsapi.AuthException: token check failed\n"
            + "\tat com.logexplorer.fixture.accountsapi.Auth.check(Auth.java:88)\n"
            + "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.dGhpc2lzYWZha2VzaWduYXR1cmU",
        "Login failed for customerId=DEMO-SENSITIVE-778899 referenceNumber=1234567890123456 "
            + "card 4111 1111 1111 1111 declined password=FixtureSecret123!"));

    // Slots 11..(11+BURST_SIZE-1): a burst.
    for (int b = 0; b < BURST_SIZE; b++) {
      int idx = base + 11 + b;
      records.add(event(rng, idx, pick(rng, SERVICES), null, null, CorrelationVariant.HEADER, false,
          null, null, "[burst] " + describeStep(rng, SERVICES.get(idx % SERVICES.size()))));
    }

    // Remaining slots: filler, for realistic volume.
    int idx = base + 11 + BURST_SIZE;
    while (records.size() < CYCLE_LEN) {
      String service = pick(rng, SERVICES);
      records.add(event(rng, idx, service, null, null,
          pick(rng, List.of(CorrelationVariant.HEADER, CorrelationVariant.LITERAL)), false,
          null, null, describeStep(rng, service)));
      idx++;
    }

    return records.subList(0, CYCLE_LEN);
  }

  private String event(Random rng, int i, String service, String journeyId, String traceId,
      CorrelationVariant correlationVariant, boolean unknownField, String level, String exception,
      String message) {
    Map<String, Object> root = new LinkedHashMap<>();
    root.put("@timestamp", Instant.EPOCH.toString()); // overwritten by restamp()
    root.put("@version", "1");
    root.put("message", message);
    root.put("logger_name", "com.logexplorer.fixture." + service.replace("-", "") + ".App");
    root.put("thread_name", "fixture-thread-" + (i % 20));
    String resolvedLevel = level != null ? level : (i % 11 == 0 ? "WARN" : "INFO");
    root.put("level", resolvedLevel);
    root.put("level_value", resolvedLevel.equals("ERROR") ? 40000 : resolvedLevel.equals("WARN") ? 30000 : 20000);
    root.put("application", service);
    if (exception != null) {
      root.put("exception", exception);
    }

    Map<String, Object> mdc = new LinkedHashMap<>();
    mdc.put("traceId", traceId != null ? traceId : "fixture-trace-" + pad(i, 6));
    mdc.put("spanId", "fixture-span-" + pad(i, 6));
    mdc.put("eventId", "fixture-event-" + pad(i, 6));
    mdc.put("x-journey-trace-id", journeyId != null ? journeyId : "fixture-journey-" + pad(i / 7, 4));
    mdc.put("stepName", pick(rng, List.of("validate-request", "debit-account", "credit-account",
        "notify-customer", "route-request")));
    mdc.put("UIIdentifier", pick(rng, List.of("screen.transfer.confirm", "screen.login",
        "screen.dashboard", "screen.support.ticket")));
    mdc.put("ERROR_CODE", pick(rng, List.of("ERR_NONE", "ERR_TIMEOUT", "ERR_VALIDATION", "ERR_UPSTREAM_5XX")));
    mdc.put("devicePlatformType", pick(rng, List.of("ANDROID", "IOS", "WEB")));
    mdc.put("language", pick(rng, List.of("en", "ar")));
    mdc.put("serverIp", "172.21." + (i % 10) + "." + ((i * 3) % 255));
    mdc.put("serverHost", "fixture-host-" + ((i % 6) + 1));
    mdc.put("cif", "FAKE-CIF-" + pad(1000 + (i % 900), 4));
    mdc.put("UserName", "fixture.user" + (i % 37));
    mdc.put("CustomerId", "DEMO-CUST-" + pad(200000 + (i % 5000), 6));
    mdc.put("deviceId", "DEMO-DEVICE-" + pad(i % 999, 3));
    mdc.put("deviceIp", "10." + (i % 200) + "." + ((i * 7) % 200) + "." + ((i * 13) % 255));
    switch (correlationVariant) {
      case HEADER -> mdc.put("X-Correlation-id", "fixture-corr-" + pad(i, 6));
      case LITERAL -> mdc.put("event.correlationId", "fixture-corr-" + pad(i, 6));
      case NONE -> { /* no correlation key */ }
    }
    if (unknownField) {
      mdc.put("unknownFixtureField", "this-key-is-not-in-the-canonical-mdc-list");
    }
    root.put("mdc", mdc);

    try {
      return objectMapper.writeValueAsString(root);
    } catch (Exception e) {
      throw new IllegalStateException("fixture corpus generation must never fail to serialize", e);
    }
  }

  private String describeStep(Random rng, String service) {
    Map<String, List<String>> verbs = Map.of(
        "gateway", List.of("Routed request to downstream service", "Forwarded response to client"),
        "accounts-api", List.of("Loaded account summary", "Persisted account update"),
        "payments-api", List.of("Processed payment authorization", "Settled batch payment"),
        "notification-worker", List.of("Dispatched customer notification", "Consumed JMS event"));
    return pick(rng, verbs.getOrDefault(service, List.of("Handled request")));
  }

  private String multilineException(String service, Random rng) {
    return String.join("\n",
        "java.lang.IllegalStateException: fixture upstream failure in " + service,
        "\tat com.logexplorer.fixture." + service.replace("-", "") + ".Handler.handle(Handler.java:"
            + (42 + rng.nextInt(50)) + ")",
        "Caused by: java.util.concurrent.TimeoutException: fixture timeout after 5000ms",
        "\t... 12 more");
  }

  private static String pad(int n, int width) {
    return String.format("%0" + width + "d", n);
  }

  private static <T> T pick(Random rng, List<T> options) {
    return options.get(rng.nextInt(options.size()));
  }
}
