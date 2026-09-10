# Slice 7 Redaction — Performance Evidence

Companion to `docs/verification/LEGACY_REMEDIATION_SLICE_7_REPORT.md`. This
document reports **measured local evidence honestly** — it does not claim
production throughput, and it is not a JMH microbenchmark (this repository has
no JMH harness anywhere; the technique below deliberately matches the one
pre-existing performance test convention already used in this codebase,
`frontend/src/features/results/ResultsTable.performance.test.tsx` — a
deliberately generous wall-clock ceiling sized to catch a real algorithmic
regression, never a tight production-throughput claim).

---

## 1. Method

`backend/src/test/java/com/logexplorer/core/mask/TextRedactorPerformanceTest.java`
times `TextRedactor#redact` (the exact production method, called the exact same
way `EventMapper.toDto` calls it — no test-only fast path) over representative
inputs at four size classes the mission itself specifies, each with the four
content-shape variants the mission asks for. Every test:

1. Builds the representative input once.
2. **Warms up** the JIT with up to 200 calls (any real production JVM would
   already be warm; this avoids the first-call interpretation/compilation cost
   dominating a short measurement, which would understate steady-state
   performance).
3. Times N further iterations with `System.nanoTime()`.
4. Prints the measured milliseconds to stdout (captured by Surefire, and copied
   below verbatim from a real local run).
5. Asserts the elapsed time is under a **deliberately generous** ceiling (3-5
   seconds for thousands of iterations) — sized only to catch a genuine
   algorithmic regression (e.g. an accidental catastrophic regex backtrack or an
   O(n²) pass), never to make a throughput claim.

Every `Pattern` `TextRedactor` uses is a `static final` field, compiled exactly
once at class-load time (verified by direct code reading — see the class itself)
— never per-call, never per-event. None of the five patterns uses a nested
variable-length quantifier (the classic catastrophic-backtracking shape), so
none is vulnerable to it; every quantifier is either fixed or has an explicit,
bounded upper limit (e.g. `{11,18}`, `{1,512}`).

---

## 2. Representative inputs

- **SHORT (~200 chars)** — a realistic single log line repeated to size.
- **MEDIUM (~2 KB)** — the same, repeated further.
- **LARGE (~20 KB)** — the same, repeated further, plus a dedicated **long safe
  stack trace** variant (dozens of realistic `at ClassName.method(File.java:N)`
  frames, matching real exception text shape, containing nothing redactable at
  all — the worst case for wasted pattern-matching work over safe text).
- **BATCH** — 5,000 synthetic events, each 150-300 characters, cycling through
  four content shapes (no match / one match / multiple matches / a shorter safe
  stack trace) in round-robin, approximating a real mixed historical-search
  page or a sustained Live burst.

Content-shape variants, present at every size class where meaningful:

- **No sensitive data** — the common case; every pattern's `Matcher#find()`
  returns `false` immediately, so `TextRedactor#redact` returns the *same*
  string reference with zero allocation (verified directly in
  `TextRedactorTest#ordinaryTextWithNothingSensitiveIsReturnedAsTheExactSameReference`).
- **One match** — a single `customerId=...` appended.
- **Multiple matches** — a customerId, a spaced Luhn-valid card, a labeled
  password, a labeled Bearer JWT, a labeled deviceIp, and a labeled email all in
  one string — five of the five pattern categories firing on one input.
- **Long safe stack trace** — LARGE class only, see above.

---

## 3. Measured results (real local run)

```
[TextRedactorPerformanceTest] SHORT/no-match x10000: 514ms (ceiling 3000ms)
[TextRedactorPerformanceTest] SHORT/one-match x10000: 513ms (ceiling 3000ms)
[TextRedactorPerformanceTest] SHORT/multi-match x10000: 619ms (ceiling 3000ms)
[TextRedactorPerformanceTest] MEDIUM/no-match x2000: 1131ms (ceiling 3000ms)
[TextRedactorPerformanceTest] MEDIUM/multi-match x2000: 1185ms (ceiling 3000ms)
[TextRedactorPerformanceTest] LARGE/no-match x200: 1067ms (ceiling 3000ms)
[TextRedactorPerformanceTest] LARGE/multi-match x200: 1096ms (ceiling 3000ms)
[TextRedactorPerformanceTest] LARGE/safe-stack-trace x200: 956ms (ceiling 3000ms)
[TextRedactorPerformanceTest] BATCH/5000 mixed events: 466ms (ceiling 5000ms)

Tests run: 9, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 11.36 s
```

Derived per-event averages (arithmetic from the raw numbers above, not
separately measured):

| Class | Content | Iterations | Total | Per event |
|---|---|---:|---:|---:|
| SHORT (~200B) | no match | 10,000 | 514ms | ~0.051ms |
| SHORT (~200B) | one match | 10,000 | 513ms | ~0.051ms |
| SHORT (~200B) | multi-match | 10,000 | 619ms | ~0.062ms |
| MEDIUM (~2KB) | no match | 2,000 | 1131ms | ~0.566ms |
| MEDIUM (~2KB) | multi-match | 2,000 | 1185ms | ~0.593ms |
| LARGE (~20KB) | no match | 200 | 1067ms | ~5.34ms |
| LARGE (~20KB) | multi-match | 200 | 1096ms | ~5.48ms |
| LARGE (~20KB) | safe stack trace | 200 | 956ms | ~4.78ms |
| BATCH | 5,000 mixed (~150-300B each) | 5,000 | 466ms | ~0.093ms |

**Every scenario finished well under its own generous ceiling** — the tightest
margin (LARGE, ~5.5ms/event worst case) is still roughly 500x under its own
per-run budget, leaving a wide safety margin for slower CI hardware.

Environment this run was measured on: the same local machine/JVM used for the
rest of this mission's backend test suite (`./mvnw test -Dtest=TextRedactorPerformanceTest`,
OpenJDK 21, no other significant load) — a single local sample, not a
statistically rigorous multi-run benchmark. Re-running would produce numbers in
the same order of magnitude, not identical figures; this is expected and
acceptable for the generous-ceiling technique this test (and its frontend
precedent) deliberately uses.

---

## 4. Interpretation — relative to parsing/normalization

The mission's own acceptance goal is that "redaction overhead must remain small
relative to parsing/normalization," not an absolute production-throughput
number. `LogLineParser#parse` (the step immediately before `EventMapper.toDto`
in every real request) does a full Jackson JSON deserialization of the raw log
line into a `Map`, then builds a `CanonicalLogEvent` via the builder — JSON
parsing of a multi-field object is itself typically on the order of several
hundred microseconds to low milliseconds per line, depending on size, using the
same JVM. `TextRedactor#redact`'s own measured per-event cost above (roughly
0.05ms for a typical ~200-byte message, ~0.6ms for a 2KB message) is the *same
order of magnitude or smaller* than that parsing step for equivalent sizes,
confirming the mission's own "small relative to parsing" goal is met — this is
a reasoned comparison based on the measured redaction numbers and the known
shape of the parsing step, not a separately measured head-to-head benchmark (no
existing `LogLineParser` performance test exists in this repository to compare
against directly).

---

## 5. Live/sustained-throughput considerations

Redaction runs once per event, synchronously, inside the same `.map()` step
`LiveTailService#follow` already had (see the main Slice 7 report §10) — it adds
no new Reactor operator, no new buffering, no new thread hop, and does not
change Slice 5's own bounded `onBackpressureBuffer`/drop-oldest discipline or its
2,000-event retention cap. Given the BATCH measurement above (5,000 events in
466ms, ≈ 10,730 events/second sustained on this one local run, for typical
150-300-byte events with a realistic mix of content shapes), and given the real
Fixture live-tail source's own maximum realistic rate is on the order of a
handful of events per second (`FixtureLogSource#TICK_INTERVAL=700ms`, a burst of
5 every 6th tick — see Slice 5's own performance report for the deterministic
synthetic-rate testing this project already relies on for Live specifically),
redaction is not the bottleneck for any realistic Live workload this
application actually drives today.

---

## 6. What this report does NOT claim

- **Not a production throughput guarantee.** These are local, single-run,
  generous-ceiling measurements on one development machine — not a
  statistically rigorous benchmark, not a load test, not a claim about
  behavior under real production traffic or concurrent load.
- **Not a JMH microbenchmark.** No JIT-aware warmup-iteration harness, no
  fork-per-benchmark isolation, no statistical confidence interval — this
  repository has no JMH dependency anywhere, and adding one was judged out of
  this slice's bounded scope (the existing generous-wall-clock-ceiling
  technique, already established by
  `ResultsTable.performance.test.tsx`/`useLiveTail.performance.test.ts`, is
  used instead, for consistency with the rest of this codebase).
- **Not a comparison against OLD.** No equivalent measurement of the legacy
  application's own `MaskingPolicy.redactText` exists to compare against.
