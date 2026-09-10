package com.logexplorer.core.mask;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ThreadLocalRandom;
import org.junit.jupiter.api.Test;

/**
 * Legacy Remediation Slice 7 — performance acceptance evidence (mission's
 * own "PERFORMANCE ACCEPTANCE" section). Not a JMH microbenchmark (this
 * repository has no JMH harness anywhere); follows the exact same
 * technique the pre-existing frontend performance tests already use
 * ({@code ResultsTable.performance.test.tsx}) - a deliberately generous
 * wall-clock ceiling, sized to catch only a real algorithmic regression
 * (e.g. accidental catastrophic regex backtracking or an O(n²) pass),
 * never a tight production-throughput claim. Measured numbers are printed
 * to stdout (captured by surefire) and copied, honestly, into {@code
 * docs/verification/SLICE_7_REDACTION_PERFORMANCE_REPORT.md} - this test
 * only asserts the generous ceiling, it does not claim production
 * throughput.
 */
class TextRedactorPerformanceTest {

  private final TextRedactor redactor = new TextRedactor();

  private static String repeatSafeText(int approxChars) {
    StringBuilder sb = new StringBuilder(approxChars + 64);
    String unit = "Loaded account summary for request req-8891 in 42ms status=200 traceId=fixture-trace-000006 ";
    while (sb.length() < approxChars) {
      sb.append(unit);
    }
    return sb.substring(0, approxChars);
  }

  private static String withOneMatch(String base) {
    return base + " customerId=778899";
  }

  private static String withManyMatches(String base) {
    return base
        + " customerId=778899 card 4111 1111 1111 1111 declined password=Secret123!"
        + " Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sigSigSigSigSig"
        + " deviceIp=10.0.0.14 email=jane.doe@example.com";
  }

  private static String longSafeStackTrace(int approxChars) {
    StringBuilder sb = new StringBuilder(approxChars + 256);
    sb.append("java.lang.IllegalStateException: fixture upstream failure in payments-api\n");
    int line = 42;
    while (sb.length() < approxChars) {
      sb.append("\tat com.logexplorer.fixture.paymentsapi.Handler.handle(Handler.java:").append(line++).append(")\n");
    }
    sb.append("Caused by: java.util.concurrent.TimeoutException: fixture timeout after 5000ms\n\t... 12 more");
    return sb.toString();
  }

  private long timeIterations(String text, int iterations) {
    // Warm up the JIT before measuring, same rationale any JVM
    // microbenchmark needs - the first handful of calls are dominated by
    // interpretation/compilation, not the algorithm itself.
    for (int i = 0; i < Math.min(iterations, 200); i++) {
      redactor.redact(text);
    }
    long start = System.nanoTime();
    for (int i = 0; i < iterations; i++) {
      redactor.redact(text);
    }
    return (System.nanoTime() - start) / 1_000_000; // ms
  }

  private void reportAndAssert(String label, long elapsedMs, long ceilingMs) {
    System.out.println("[TextRedactorPerformanceTest] " + label + ": " + elapsedMs + "ms (ceiling " + ceilingMs + "ms)");
    assertThat(elapsedMs)
        .as("%s took %dms, expected under the generous %dms ceiling (catches only a real algorithmic regression)",
            label, elapsedMs, ceilingMs)
        .isLessThan(ceilingMs);
  }

  // ---------------------------------------------------------------------
  // SHORT (~200 chars), 10,000 iterations each
  // ---------------------------------------------------------------------

  @Test
  void shortMessageNoSensitiveDataStaysWellWithinTheGenerousCeiling() {
    String text = repeatSafeText(200);
    reportAndAssert("SHORT/no-match x10000", timeIterations(text, 10_000), 3_000);
  }

  @Test
  void shortMessageOneMatchStaysWellWithinTheGenerousCeiling() {
    String text = withOneMatch(repeatSafeText(180));
    reportAndAssert("SHORT/one-match x10000", timeIterations(text, 10_000), 3_000);
  }

  @Test
  void shortMessageMultipleMatchesStaysWellWithinTheGenerousCeiling() {
    String text = withManyMatches(repeatSafeText(80));
    reportAndAssert("SHORT/multi-match x10000", timeIterations(text, 10_000), 3_000);
  }

  // ---------------------------------------------------------------------
  // MEDIUM (~2KB), 2,000 iterations each
  // ---------------------------------------------------------------------

  @Test
  void mediumMessageNoSensitiveDataStaysWellWithinTheGenerousCeiling() {
    String text = repeatSafeText(2_000);
    reportAndAssert("MEDIUM/no-match x2000", timeIterations(text, 2_000), 3_000);
  }

  @Test
  void mediumMessageMultipleMatchesStaysWellWithinTheGenerousCeiling() {
    String text = withManyMatches(repeatSafeText(2_000));
    reportAndAssert("MEDIUM/multi-match x2000", timeIterations(text, 2_000), 3_000);
  }

  // ---------------------------------------------------------------------
  // LARGE (~20KB), 200 iterations each - including a long safe stack trace
  // ---------------------------------------------------------------------

  @Test
  void largeMessageNoSensitiveDataStaysWellWithinTheGenerousCeiling() {
    String text = repeatSafeText(20_000);
    reportAndAssert("LARGE/no-match x200", timeIterations(text, 200), 3_000);
  }

  @Test
  void largeMessageMultipleMatchesStaysWellWithinTheGenerousCeiling() {
    String text = withManyMatches(repeatSafeText(20_000));
    reportAndAssert("LARGE/multi-match x200", timeIterations(text, 200), 3_000);
  }

  @Test
  void longSafeStackTraceStaysWellWithinTheGenerousCeiling() {
    String text = longSafeStackTrace(20_000);
    reportAndAssert("LARGE/safe-stack-trace x200", timeIterations(text, 200), 3_000);
  }

  // ---------------------------------------------------------------------
  // BATCH - thousands of typical (short-to-medium, mixed) events
  // ---------------------------------------------------------------------

  @Test
  void batchOfFiveThousandTypicalMixedEventsStaysWellWithinTheGenerousCeiling() {
    List<String> batch = new ArrayList<>(5_000);
    ThreadLocalRandom rng = ThreadLocalRandom.current();
    for (int i = 0; i < 5_000; i++) {
      String base = repeatSafeText(150 + rng.nextInt(150)); // ~150-300 chars, typical message size
      int kind = i % 4;
      batch.add(switch (kind) {
        case 0 -> base; // no sensitive data
        case 1 -> withOneMatch(base); // one match
        case 2 -> withManyMatches(base); // multiple matches
        default -> longSafeStackTrace(500); // a shorter safe stack trace mixed in
      });
    }
    // Warm-up.
    for (int i = 0; i < 500; i++) {
      redactor.redact(batch.get(i % batch.size()));
    }
    long start = System.nanoTime();
    for (String event : batch) {
      redactor.redact(event);
    }
    long elapsedMs = (System.nanoTime() - start) / 1_000_000;
    reportAndAssert("BATCH/5000 mixed events", elapsedMs, 5_000);
  }
}
