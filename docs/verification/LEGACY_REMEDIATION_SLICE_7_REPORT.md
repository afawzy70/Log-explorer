# Legacy Remediation Slice 7 — Conservative Free-Text Sensitive-Data Redaction

Verification report for the owner-authorized **LEGACY REMEDIATION SLICE 7** mission.
Base SHA `095c55a` / `095c55a0eb6282fbe17d277c3bf459e816726691` (`main`, PR #26
merged — Legacy Remediation Slice 6). Branch `phase/legacy-slice7-redaction`.

**THIS IS CONSERVATIVE, HIGH-CONFIDENCE REDACTION, NOT A COMPLETE DLP SYSTEM.**
It closes a real defense-in-depth gap — the five named structured sensitive fields
(`cif`/`UserName`/`CustomerId`/`deviceId`/`deviceIp`) were already masked server-side,
but a similar-looking value typed by hand into a free-text `message` or `exception`
string passed through completely unscanned. This slice adds a small, fixed,
high-confidence pattern set for that gap — it does not attempt general-purpose
secret/PII detection, and known limitations are documented explicitly in §12.

---

## 1. Redaction architecture — the single boundary

**One authoritative server-side boundary, extending the pre-existing one.**
`core.mask.MaskingService` already masks the five structured fields at a single
point, `api.EventMapper.toDto` (the ArchUnit-enforced "only `MaskingService` may
touch `RawSensitiveFields`" boundary — unchanged). This slice adds `core.mask.TextRedactor`,
injected into `EventMapper` alongside `MaskingService`, and calls it from the exact
same method — never a second boundary anywhere else:

```java
// EventMapper.toDto
textRedactor.redact(event.message())
textRedactor.redact(event.exception())
textRedactor.redact(event.rawLine())                        // malformed events only
textRedactor.redactStringValues(event.unknownTopLevelFields())
textRedactor.redactStringValues(event.unknownMdcFields())
```

Because `/search`, `/context`, `/journey`, and the Live SSE stream **all** already
funnel through `EventMapper.toDto` (verified by reading `SearchController`/
`LiveTailService` directly, not assumed), extending this one method protects all
four automatically — there is no per-endpoint divergence to introduce or maintain.
`EventFilters#matches` (server-side search filtering) runs strictly *before* this
boundary, on the true, unredacted `CanonicalLogEvent` — free-text search still
matches real content (§9).

**Scope decision beyond the pre-existing forward-planning doc**: `docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md`'s
own Slice 7 section (written before this mission's own detailed authorization)
named only `message`/`exception`. This mission's own §8/§9 explicitly ask for
exception/stack-trace text and "unknown/custom fields... where appropriate" —
this implementation also covers `rawLine` (a malformed event's raw text, an
equally plausible free-text carrier) and the immediate `String`-typed values of
`unknownTopLevelFields`/`unknownMdcFields`, bounded to depth 0 (§8 below). This is
a deliberate, documented extension of scope, not an oversight.

---

## 2. Exact protected categories & contextual pattern rules

Five sequential regex passes, each compiled exactly once (`static final Pattern`),
applied in this fixed order (`TextRedactor#redact`):

1. **Bearer/Basic authorization** — `\b(Bearer|Basic)\s+[A-Za-z0-9\-_.+/=]{8,}` →
   `<word> [REDACTED]` (the literal word "Bearer"/"Basic" as actually written is
   preserved, matching the mission's own example "Authorization: Bearer [REDACTED]").
2. **Auth/secret key=value** — the mission's own explicit 8-alias list only:
   `password`, `passwd`, `pwd`, `client_secret`, `api_key`, `apikey`,
   `access_token`, `refresh_token` → `label=[REDACTED]`. Deliberately **not**
   broadened to a bare `token=`/`secret=` catch-all — see §12.
3. **Contextual identifiers** — CIF/customerId/username/deviceId aliases, IP
   aliases scoped to user/device/client context, and labeled-only email aliases
   (§5/§6) → `label=[REDACTED]`. Matches four shapes: `label=value`, `label:
   "value"`, `"label":"value"` (quoted JSON key), `label [value]` (bracket form),
   and a bare `label value` with no separator at all — but *only* when the value
   contains a digit (e.g. "CIF 99887766 failed authentication"), which is what
   keeps ordinary prose like "username is required" from ever being mistaken for
   a value.
4. **Standalone JWT** (§4) — a structural match only, never after the Bearer pass
   has already consumed a labeled one.
5. **Card-like numbers** (§3) — Luhn-validated only.

Full alias list — `TextRedactor.CONTEXTUAL_ID_LABELS`:
`CIF`, `customerId`/`customer_id`/`customer-id`, `username`/`user_name`,
`deviceId`/`device_id`/`device-id`, `deviceIp`/`device_ip`/`device-ip`,
`clientIp`/`client_ip`/`client-ip`, `customerIp`/`customer_ip`/`customer-ip`,
`userIp`/`user_ip`/`user-ip`, `email`/`userEmail`/`user_email`/`customerEmail`/
`customer_email`/`accountEmail`/`account_email`. All matched case-insensitively.

---

## 3. Card / Luhn semantics

A candidate is any digit, followed by 11-18 more digits each optionally preceded
by a single space or hyphen, bounded on both sides by a negative lookaround
(`(?<![A-Za-z0-9])...(?![A-Za-z0-9])`) so it can never match a digit run embedded
inside a longer alphanumeric token (a UUID/hex-trace-ID fragment, a session token).
The raw match is then, in code (never in the regex itself, for clarity):

1. Stripped of separators.
2. Rejected outright if the resulting digit count is outside **13-19** (the real
   PAN range across Visa/Mastercard/Amex/Discover etc.) — this is a second,
   explicit safety net beyond the regex's own looser 12-19 bound (a 12-digit UUID
   tail segment structurally *can* match the regex; the explicit length check
   rejects it before Luhn is ever even computed).
3. **Luhn-validated.** Only a passing checksum is replaced, with `[REDACTED_CARD]`
   — an invalid candidate (wrong checksum) is left **completely untouched**,
   verbatim, including its own spaces/hyphens.

Verified with real, well-known values: `4111111111111111` (no separators),
`4111 1111 1111 1111` (spaces), `4111-1111-1111-1111` (hyphens) — all a genuine
Visa test PAN, all Luhn-valid, all redacted. `1234567890123456` (16 digits) —
hand-verified to fail Luhn (checksum 64, not divisible by 10) — stays visible in
every test that uses it, including the real end-to-end fixture (§10).

---

## 4. JWT policy

A **purely structural** match: exactly three base64url segments (`[A-Za-z0-9_-]`),
each **at least 10 characters**, joined by dots, with boundary lookarounds that
exclude a 4th adjacent dot-segment (so a longer dotted chain, e.g. a
fully-qualified class name, never partially matches). The 10-character-per-segment
floor is what keeps `1.2.3` (a version string) and short package-path segments
from ever being mistaken for a token — real JWT header/payload/signature segments
are always far longer than 10 characters in practice.

**Never decodes claims.** The match is purely `Pattern`-based; no base64 decoding
of any segment ever happens, anywhere in this class. **Never logs the matched
token** — the replacement is the fixed marker `[REDACTED_TOKEN]`, nothing else is
ever written anywhere (§16 of the mission; also covered by `SourceHealthLeakTest`-style
discipline, not repeated per-class here since nothing in this class calls a
logger at all).

Runs **after** the Bearer/Basic pass, so `Authorization: Bearer <jwt>` is already
fully consumed as one unit (`Authorization: Bearer [REDACTED]`) by the time the
standalone-JWT pass would otherwise see it — this pass only ever fires on a
genuinely unlabeled token appearing bare in text.

---

## 5. Email policy — conservative, documented

**No blanket email redaction.** Only when explicitly labeled: `email`, `userEmail`,
`user_email`, `customerEmail`, `customer_email`, `accountEmail`, `account_email`
(the same contextual-identifier mechanism as §2, item 3). An email mentioned for
a legitimate operational reason with no such label — "contact support at
support@example.com for help" — is left completely untouched. This is a
deliberate policy choice: CLAUDE.md's own five named sensitive fields do not
include email at all, and no existing repository requirement mandates masking it;
a blanket email-shape scan would be exactly the kind of over-broad,
false-positive-prone behavior the mission explicitly warns against.

---

## 6. IP policy — exact semantics

**Redacted only when labeled** as a user/device/client-scoped IP: `deviceIp`,
`clientIp`, `customerIp`, `userIp` and their `_`/`-` separator variants (the same
contextual-identifier mechanism). **`serverIp`/`serverHost` are dedicated
structured fields on `CanonicalLogEvent`** — distinct from `message`/`exception`
free text entirely, never scanned by `TextRedactor` at all — and a bare mention of
a server/source IP inside free text with no user/device/client label (e.g.
"connected from server ip 10.0.0.5") is explicitly, deliberately left visible:
server/source infrastructure IPs remain valuable operational evidence, per the
mission's own instruction. Verified by a dedicated negative test
(`serverInfrastructureIpIsNeverRedactedByFreeTextScanning`).

---

## 7. Idempotence

Every marker is a stable fixed point: `[REDACTED]` contains no `[:=]`-preceded
label match trigger of its own once already substituted in, `[REDACTED_CARD]`
contains no 13-19-digit run, `[REDACTED_TOKEN]` contains no dot. Concretely, the
canonical replacement form is always `label=[REDACTED]` (uniform, regardless of
which of the four separator shapes matched on the *first* pass) — a *second* pass
re-matches that exact string via the same `[:=]`-separator alternative and
reproduces byte-for-byte the same output. Two real bugs were found and fixed by
the idempotence tests themselves during development (documented honestly, not
hidden): the value-capture character class originally excluded `]`/`}`, which
broke re-matching an already-bracketed marker — fixed by *including* `[`/`]` in
the value char class (the alternative bracket-form path already anchors on a
literal `\[`/`\]`, so there is no ambiguity). Covered by
`alreadyRedactedTextIsUnchangedByARepeatRun`, `redactingAnAlreadyPlainMarkerStringIsAStableFixedPoint`,
and `tripleApplicationIsIdenticalToSingleApplication`.

---

## 8. Unknown/custom field handling

**Bounded to depth 0 — the safest possible reading of "bounded recursion depth OR
known canonical string-bearing fields."** `TextRedactor#redactStringValues(Map<String,Object>)`
scans only the *immediate* value of each map entry: a `String` value is redacted;
any other shape (`Integer`, `Boolean`, a nested `Map`, a `List`) is returned
**completely untouched, with zero recursion at all**. A nested map's own
`"customerId"` key, one level down, is never inspected — verified explicitly
(`redactStringValuesOnlyTouchesImmediateStringValuesNeverRecursing`). This is a
deliberate simplification: recursing into arbitrary JSON-shaped values, even with
a depth cap, adds real traversal cost and a real (if small) new attack surface for
pathological input shapes; scanning only known-string leaves at the map's own
top level is O(k) in the number of entries, each redaction itself O(string
length) — no additional depth, no new risk class.

---

## 9. Search semantics — protected

`EventFilters#matches` (server-side text/field filtering) always operates on the
**raw, unredacted** `CanonicalLogEvent` — it runs entirely inside `SearchService`/
adapter `search()`/`follow()` implementations, before any event ever reaches
`EventMapper.toDto`. Redaction never touches the raw sensitive-filter values used
for server-side matching either (unchanged from the pre-existing `RawSensitiveFields`
boundary). Verified end-to-end:
`freeTextSearchStillMatchesAgainstTheRealUnredactedMessageContent`
(`TextRedactionEndpointLeakTest`) — searching for `"Login failed"` (a substring of
the fixture's sensitive-data event's message, itself surviving redaction as
ordinary prose) still finds the event, proving the match happens against the true
content, not a redacted copy. The query-plan redaction system
(`core.query.QueryPlanExplainer`, unconditionally replacing every DSL/raw-LogQL
literal with `***`) is a **separate, pre-existing system protecting query *input*
text**, never touched by this slice — no overlap, no duplication, no conflict
(confirmed by reading both code paths directly; they share no class, no call site).

---

## 10. Live — SSE redaction & Slice 5 invariants

Free-text redaction runs inside the exact same `.map(event -> logEvent(eventMapper.toDto(event)))`
step `LiveTailService#follow` already had — a pure, synchronous, per-element
transform already in the pipeline; no new Reactor operator, no new backpressure
semantics, no change to the bounded `onBackpressureBuffer`/drop-oldest discipline.
Verified at the unit level
(`LiveTailServiceTest#everyEmittedLogEventHasItsFreeTextRedactedBeforeItEverReachesTheStream`)
and, more importantly, against the **real** app: `FixtureCorpusGenerator`'s new
slot 10 (§11) cycles into the real live-tail stream at real Fixture pacing
(`TICK_INTERVAL=700ms`), and E2E scenario 6 polls the real running Live panel and
finds the real redacted content within ~5-7 real seconds. Slice 5's own retention
semantics (2,000-event cap) and reconnect/backoff engine were **not** touched by
this slice; E2E scenario 14 re-confirms Start/Pause/Resume/Stop still work end to
end after this change.

---

## 11. The real end-to-end fixture

`FixtureCorpusGenerator.buildCycle` gained one new deterministic slot (slot 10,
between the pre-existing "unknown MDC field" slot 9 and the burst), guaranteed
once per 40-record cycle — a small, safe, test-data-only addition (dev/test
profile only). Its message combines a contextual identifier, a valid-Luhn
spaced card number, and a labeled password; its exception combines a real
class/method/file/line stack frame with a labeled Bearer JWT; and it carries one
deliberately Luhn-**invalid** 16-digit `referenceNumber` that must remain
visible. This is the single fixture E2E's 9 new scenarios all key off — verified
directly against the real running backend before writing the Playwright spec
(`curl` against `/api/v1/logs/search`, full response pasted into this repo's own
session log): `customerId=[REDACTED]`, `[REDACTED_CARD]`, `password=[REDACTED]`,
`Authorization: Bearer [REDACTED]` all present; `referenceNumber=1234567890123456`
and the stack trace's own class/method/file/line all present, verbatim.

Slot insertion was verified safe against every existing test that touches
`FixtureCorpusGenerator`'s slot layout (`FixtureCorpusGeneratorTest`,
`FixtureLogSourceTest`'s own burst-timing test) — all assert on *content
existence* (`anyMatch`/event *counts*), never a raw slot index, confirmed by
direct reading before the change, not assumed; the full backend and E2E suites
both stayed 100% green afterward (§13).

---

## 12. Known limitations (honest, by design)

**This is conservative, high-confidence redaction, not a complete DLP system.**
Explicitly, the following remain undetected, by deliberate design:

- **Unlabeled arbitrary customer IDs** — a bare number or code with no
  recognized label/context (no `customerId=`, no `CIF`, etc.) is never redacted;
  there is no way to distinguish it from an ordinary order number, timestamp
  fragment, or trace ID without a label.
- **Novel proprietary token formats** — only the mission's own explicit 8-alias
  secret-label list and the structural JWT/Bearer patterns are covered; a
  company-internal token format with none of those shapes/labels passes through.
- **Encoded/encrypted secrets** — a base64-encoded or otherwise obfuscated secret
  with no recognizable structural shape (not JWT-shaped, no label) is invisible
  to a pattern-based scanner by construction.
- **Data without sufficient contextual evidence** — by design, this system
  requires either a label (contextual identifiers, secrets) or a strong
  structural signal (JWT shape, Luhn-valid card) before redacting anything;
  anything with neither stays visible. This is the intended, documented
  trade-off: **correct conservative behavior is better than destructive
  guessing** (the mission's own words).
- **No bare `token=`/`secret=` catch-all** — deliberately not added beyond the
  mission's own explicit 8-item label list, to avoid mangling legitimate
  non-secret fields that happen to be named similarly (e.g. a numeric "token
  count").
- **No telemetry/counters were added** — the mission's own §16 wording made this
  optional ("may include... if useful and not noisy"); given the added
  observability surface wasn't justified by a demonstrated need in this pass, it
  was left out. Aggregate redaction counts could be added later without
  disturbing the redaction boundary itself.
- **Patterns are fixed, compiled-once constants — not externally configurable**
  in this slice, unlike the older, superseded forward-planning doc's suggestion
  of a `MaskingProperties#textPatterns` config surface. A configurable pattern
  set would let a future misconfiguration reintroduce a catastrophic-backtracking
  risk; a small, fixed, conservative set is safer and simpler. If a real gap is
  found in production log data later, extending the fixed pattern list is a
  small, reviewable code change, not a runtime config risk.

---

## 13. Tests

### Backend — `./mvnw --batch-mode verify`

```
[INFO] Tests run: 595, Failures: 0, Errors: 0, Skipped: 0
[INFO] BUILD SUCCESS
```

Baseline (Slice 6 merge) was 508; 508 + 87 = 595. New: `TextRedactorTest` (new, 67
— every positive/negative/idempotence/unknown-field case §18/§19/§11 of the
mission, parameterized where natural), `SerializationLeakTest` (+6 — sentinel
values embedded in message/exception/rawLine/unknown fields, never reaching
serialized JSON), `TextRedactionEndpointLeakTest` (new, 4 — real HTTP-layer proof
for `/search`/`/context`/`/journey`, plus the free-text-search-still-works
regression test), `LiveTailServiceTest` (+1 — the Live SSE redaction boundary),
`TextRedactorPerformanceTest` (new, 9 — see the dedicated performance report).

### Frontend — `npm run typecheck && npm run test -- --run && npm run build`

```
tsc -b --noEmit             -> clean
Test Files  56 passed (56)
Tests       606 passed (606)
vite build                  -> ✓ built in 484ms (dist/assets/index-AkCFDSKj.js 287.74 kB / gzip 86.00 kB, byte-identical output size to the Slice 6 baseline - zero frontend production code was changed)
```

Baseline was 595; 606 passed after this slice's additions. **No frontend
production code was changed** — "frontend should not own redaction" (mission's
own instruction) is satisfied by construction: every display component already
rendered `message`/`exception` as plain text (`{event.message}`, never
`dangerouslySetInnerHTML`), so once the backend sends already-redacted text,
every existing component renders it correctly with zero code changes. New tests
only verify this contract holds using already-redacted fixtures: `EventInspector.test.tsx`
(+6 — Business/error section, overview/title, raw-JSON dump, no reveal action,
axe), `ResultsTable.test.tsx` (+3 — table cell rendering, malformed rawLine,
Actions menu never offers to copy message/exception), `JourneyEntryRow.test.tsx`
(+2 — shared by both Journey view and Live tail), `persistence.test.tsx` (+1 — a
full app-level interaction viewing an already-redacted event in the inspector,
confirming zero localStorage/sessionStorage/URL writes throughout).

### E2E — `npx playwright test`

```
153 passed (5.2m)
```

New file `frontend/e2e/phase-legacy-slice7-redaction.spec.ts` (9 tests, covering
all 16 mission-listed browser scenarios — several combined where they naturally
chain, e.g. items 1-2-13 and items 3/8/9/10/11/12). Run against the real backend
(`SPRING_PROFILES_ACTIVE=dev`, Fixture source) — deliberately **never mocked**
for this mission, since the redaction logic itself lives server-side and a mocked
API response would prove nothing about the real `TextRedactor`. Baseline (Slice 6
merge) was 144; 144 + 9 = 153 — every pre-existing spec passes unmodified,
including the full narrow/zoom regression suites across every other phase.

Screenshots: `docs/verification/legacy-slice7/search-redacted-row.png`,
`inspector-redacted.png`, `context-redacted.png`, `journey-redacted.png`,
`live-redacted.png`, `narrow-390px-redacted.png`.

---

## 14. Commands run

```
cd backend && ./mvnw --batch-mode verify                                  # 595 passed, BUILD SUCCESS
cd frontend && npm run typecheck                                           # clean
cd frontend && npm run test -- --run                                       # 606 passed
cd frontend && npm run build                                               # succeeded
SPRING_PROFILES_ACTIVE=dev ./mvnw --batch-mode --quiet spring-boot:run &   # real backend for E2E
cd frontend && npx playwright test                                         # 153 passed
```

---

## 15. Regressions

None. Every pre-existing backend test (508 baseline), frontend test (595 baseline,
all still passing unmodified), and Playwright spec (144 baseline, all still
passing unmodified) continues to pass. The one fixture-generator change
(`FixtureCorpusGenerator`'s new slot 10) was verified safe against every test
that reads its slot layout before making the change, and confirmed green
afterward.

## 16. Scope discipline

Not touched: Slice 8+, a general enterprise DLP platform, external DLP SaaS
integration, ML/LLM-based redaction, JWT claim decoding, storing sensitive-value
hashes for later comparison, Docker connection security, the Query DSL,
pagination, row-click-to-inspect, auth/RBAC. No auto-merge was performed. Phase M
was not started.

## 17. Owner decisions — explicitly verified untouched

- **The five structured sensitive fields' own masking** (`MaskingService`) —
  completely unchanged; `MaskingServiceTest`'s own 19 tests still pass unmodified.
- **No raw sensitive value ever exposed** — extended, not weakened: free text now
  gets the *same* never-raw guarantee the five structured fields already had.
- **No second masking boundary** — `TextRedactor` is injected into the *same*
  `EventMapper` the five-field masking already used, verified by the
  ArchUnit-enforced boundary rule continuing to pass (`ArchitectureTest`, 3/3).
