# OS-1G — OpenShift Aggregated/Historical Provider Decision

**Branch:** `os/1g-aggregated-provider-decision` (from `main`, base SHA
`9063beb8c53efd05061905e7ceb9877f0f876a99` — the OS-1F merge)
**Scope:** a decision-gate mission, per the mission's own framing — resolve
`OS-12` ("Loki becomes an aggregated/historical provider behind
OpenShift, not a peer user-facing source", `OWNER_REQUIREMENTS_REGISTER.md`
§12a) with real evidence, not assumption. Explicitly **not** a mandate to
delete Loki, remove `openshift-loki`, migrate every Loki feature, redesign
OpenShift, or start REL-1.

---

## 1. Method

Before any code was considered, the current `openshift-loki`
implementation was audited directly against its actual source —
`backend/src/main/java/com/logexplorer/source/loki/`,
`LokiProperties`, its test suite, and every prior owner decision recorded
about Loki in `docs/governance/OWNER_REQUIREMENTS_REGISTER.md` and
`docs/architecture/OPENSHIFT_DIRECT_LOGGING_ARCHITECTURE_ASSESSMENT.md`.
In parallel, this session's own environment was checked directly for a
reachable real Loki endpoint (§3) — this is the hard gate the mission
requires before any consolidation decision, and it is checked with actual
commands, not inferred.

## 2. Current Loki implementation — inventory

### LOKI_REUSABLE_COMPONENTS

Already generic, already shared with every other source (Docker, Fixture,
OpenShift Direct) — none of this is Loki-specific and none of it needs to
move for any future aggregated-provider work:

- `CanonicalLogEvent` / `LogLineParser` (`core/parse/LogLineParser`) —
  `LokiLogSource.java` feeds raw lines through the exact same parser
  every source uses. Zero Loki-specific parsing logic exists.
- `SourceCapabilities` (`core/model/SourceCapabilities.java`) — Loki
  already reports through the same generic capability record the
  frontend already renders generically (`CLAUDE.md` §4: "the frontend
  never infers what a source can do").
- `EventFilters.matches` — the same generic bounded post-filter every
  source uses for filters its own query language can't express natively.
- `CompositeX509TrustManager` (`core/tls/`) — Loki's TLS handling already
  reuses the same extra-CA-on-top-of-JVM-defaults helper OS-1A reused for
  OpenShift Direct (`LokiWebClientFactory.java`).
- `RawToken` (`core/model/RawToken.java`) — the same self-redacting token
  wrapper `OpenShiftSession` uses, already reused by
  `LokiTokenSupplier.java`.

### LOKI_SOURCE_COUPLED_COMPONENTS

Genuinely Loki-specific, not reusable by any future provider without
rewriting for a different backend's query semantics:

- `LokiQueryClient` / `LokiQueryResponse` — Loki's `query_range` HTTP
  shape, nanosecond timestamps, stream-label JSON.
- `LogQlSelectorBuilder` / `LogQlDslPlanner` — LogQL string construction,
  meaningless outside a LogQL backend.
- `LokiErrorClassifier` — Loki-specific HTTP/error-body mapping.
- `LokiWebClientFactory`'s URI-template / `VALUES_ONLY` label-encoding
  quirks — Loki-gateway-specific, though the WebClient/TLS scaffolding
  underneath is generic (see above).

### LOKI_UI_COUPLING

**Effectively none.** A repository-wide search for `"openshift-loki"` /
`"OpenShift Loki"` in `frontend/src` found no per-source branching logic
— the only hit is a CSS module class name. The frontend is entirely
capability-driven (`SourceCapabilities`, backend-declared, per `CLAUDE.md`
§4), which is precisely what makes provider-shape changes on the backend
low-risk to the frontend: raw LogQL, live tail, context view, and service
discovery are already gated by backend-reported booleans, not
source-id string checks.

### LOKI_SECURITY_COUPLING

Fully separate credential path from OpenShift Direct — no shared state,
no cross-contamination risk:

- Own token source (`tokenEnvVar`/`tokenFilePath`, `LokiTokenSupplier`),
  independent of `OpenShiftSession`'s in-memory session token.
- Own TLS/CA configuration (`LokiWebClientFactory`), independent of
  `OpenShiftApiClient`'s.
- A **fixed, deployment-time namespace** (`LokiProperties.namespace`,
  documented as "not a per-request field") — architecturally different
  from OpenShift Direct's session-selected, per-request project. This is
  the clearest technical signal that Loki was built as an
  in-cluster-deployed, single-tenant component, not a desktop-connected,
  multi-project one (the same mismatch OS-1 originally identified for why
  `openshift-loki` never felt first-class).

### LOKI_CAPABILITY_GAPS

Honestly self-reported by `LokiLogSource.capabilities()`, not hidden:

- `contextView=false` — **"Show surrounding logs" is not implemented for
  Loki at all.** No override exists; the capability honestly reports
  `false` rather than a partial/incorrect implementation.
- `liveTail=false` — deliberately hardcoded false. A prior finding
  (Legacy Remediation Slice 5) found the old config toggle let operators
  advertise a live-tail capability that would error on first use; no real
  Loki streaming was ever built.
- `serviceDiscovery=false` — a deliberate, documented boundary, not a gap.
- **No correlation/journey-specific code exists in the Loki package at
  all.** Cross-service correlation for Loki would ride entirely on the
  generic `search()` + `EventFilters` path, same as every source —
  untested against real Loki data, because no real Loki data has ever
  been available to test against.

### Test coverage

Seven backend test files
(`LokiLogSourceTest`, `LokiQueryClientTest`, `LokiWebClientFactoryTest`,
`LokiTokenSupplierTest`, `LokiTokenLeakTest`, `LokiErrorClassifierTest`,
plus a `MockLokiServer` test helper) — **all against `MockLokiServer` or
mocks. Zero tests exist against a real Loki instance.** No frontend
Loki-specific tests exist, consistent with the near-zero UI coupling
above.

## 3. Real Loki evidence gate (§6 of the mission — a hard gate)

Checked directly, in this session's actual environment, not inferred from
history:

```
$ env | grep -i loki
(no output — no LOKI_* environment variables present)

$ find / -maxdepth 3 -iname "*loki*" [excluding /proc and this repo]
(no output)

$ oc get routes -A | grep -i loki
(no output)

$ oc get svc -A | grep -i loki
(no output — the real Red Hat Developer Sandbox project used for OS-1F,
 ahmedelrifaye70-dev, hosts no Loki route or service; the only other
 accessible project, ahmedelrifaye70-aece7-claw, likewise has none)
```

The only Loki-adjacent thing in this repository is `tools/mock-loki`, and
it is **explicitly documented as a mock**, not real Loki software —
`docker-compose.yml`'s own comment: *"an offline stand-in for a real
OpenShift Loki gateway... for demonstrating the Loki source path without
a real cluster."* Spinning it up and testing against it would prove
nothing about real Loki's `query_range` behavior, timestamp precision, or
error semantics — it would just be re-testing this repository's own
`MockLokiServer`-equivalent fixture with extra steps, exactly the kind of
false confidence `CLAUDE.md` §3 forbids ("Never claim external... OpenShift
behavior was verified unless you actually connected").

Historically, every prior slice that touched this question (`UX-R2`,
`UX-R4`, `UX-R5`, `UX-R6`, OS-A) recorded the same honest result. OS-A
(`OWNER_REQUIREMENTS_REGISTER.md` §14, OS-12) explicitly left folding Loki
behind OpenShift `OPEN_UNDECIDED`, "gated on real-Loki verification that
has never existed." That evidence still does not exist.

```
REAL_LOKI=BLOCKED_EXTERNAL_ENVIRONMENT
```

Not fabricated as `PASS`. No production Loki endpoint was reachable to
this session by any means available (environment variables, local
config, the real OpenShift Sandbox namespaces already connected to for
OS-1F).

## 4. Decision matrix

| Criterion | Option A — keep separate permanently | Option B — consolidate now behind OpenShift | Option C — abstraction only, defer consolidation |
|---|---|---|---|
| User mental model | Simple today (two sources, clearly distinct) but never resolves the "why are there two OpenShift-ish sources" confusion OS-1 originally identified | Cleanest long-term model — one OpenShift experience, historical search as a mode within it | Unchanged for now; the eventual model is preserved as a documented target without being built on unverified ground |
| Historical search UX | Loki remains reachable, just not integrated | Best UX *if* Loki's context/correlation/live gaps (§2) are closed first — they are not | Deferred, honestly, rather than shipped half-verified |
| Source truthfulness | Truthful — Loki still reports its own honest (partial) capabilities as a standalone source | **Risk**: folding an untested-against-real-data provider behind the primary, freshly real-Sandbox-verified OpenShift source risks the primary source inheriting Loki's unverified correlation/context behavior by association | Truthful — nothing about `OpenShiftLogSource`'s verified behavior changes |
| Configuration complexity | Lowest — no new abstraction | New provider-selection/fallback config surface, unjustified without a second working implementation | None added this slice |
| Security | Unchanged, proven | New risk surface: an aggregated provider composed into `OpenShiftLogSource` must not let Loki's separate credential path leak into or shadow OpenShift Direct's — solvable, but a real risk to design carefully, not to rush | No new surface introduced |
| Provider capability mismatch | N/A — Loki stays honestly separate | **Real problem**: Loki lacks `contextView`/`liveTail`/correlation-testing that OpenShift Direct now has proven; presenting it as "the same OpenShift experience, just historical" without those parity gaps closed would be misleading | Mismatch stays visible (two distinct sources with distinct, honestly-declared capabilities) rather than papered over |
| Migration risk | None | **Highest** — touches `OpenShiftLogSource`, the component OS-1F just spent an entire real-Sandbox validation pass proving correct; any composition risks that hard-won verification | None — zero production code changed |
| Backward compatibility | Fully preserved | Must be carefully preserved through a new composition layer — achievable but adds real surface area for regression | Fully preserved, trivially — nothing changes |
| Raw LogQL handling | Unchanged, already capability-gated correctly | Must be re-gated so raw LogQL doesn't leak into the generic OpenShift UX (mission §9's own explicit rule) — more design work required before evidence justifies it | Unchanged |
| Docker/Loki/OpenShift semantics | Each source's semantics stay independently clear | Requires defining DIRECT vs AGGREGATED semantics precisely (mission §10) — worth doing, but only once there's a real implementation to validate the definition against | Deferred until there's something real to validate against |
| Testability | Loki's tests stay honest about testing only a mock | A composed provider's tests would still only be mock-backed — the same false-confidence problem, now with more surface area | Unchanged — no new untested surface introduced |
| Future extensibility | Weakest — revisiting this later means designing the exact same abstraction from scratch anyway | Strongest, but built on a foundation (mock-only Loki verification) that could turn out wrong once real evidence arrives, requiring rework anyway | The interface can be designed **correctly informed by real Loki behavior** once evidence exists, rather than guessed now and likely reworked |

```
OS_1G_OPTION_A_RESULT=SAFE_BUT_STAGNANT — preserves everything correctly but leaves OS-12 permanently unresolved and repeats the exact "why two OpenShift sources" confusion OS-1 was created to fix
OS_1G_OPTION_B_RESULT=REJECTED_THIS_SLICE — violates the mission's own §8 default safety rule; REAL_LOKI is not verified, and Loki's own self-reported capability gaps (no context view, no live tail, no correlation testing) mean folding it behind the just-verified primary OpenShift source would risk that source's credibility by association, not just Loki's
OS_1G_OPTION_C_RESULT=RECOMMENDED — the only option that both makes forward progress on OS-12 and respects the hard REAL_LOKI gate
```

## 5. Recommendation

```
OS_1G_RECOMMENDED_OPTION=C
```

**Rationale:** `REAL_LOKI=BLOCKED_EXTERNAL_ENVIRONMENT` (§3) triggers the
mission's own §8 default safety rule directly: do not remove
`openshift-loki`, do not claim Loki-backed historical search is
production-verified, prefer a reversible decision. Option C is the only
option consistent with that rule while still resolving OS-12 from
`OPEN_UNDECIDED` limbo into an explicit, evidence-grounded interim
position.

**Whether to write the `AggregatedLogProvider` interface itself in this
slice was a separate, narrower judgment call**, made against
`CLAUDE.md`'s own explicit anti-premature-abstraction rule ("Don't add
... abstractions beyond what the task requires... Don't design for
hypothetical future requirements... Three similar lines is better than a
premature abstraction"). Two considerations decided it:

1. There is exactly one candidate implementation (Loki), and that
   implementation's own real-world behavior — the thing an interface
   should be shaped around — has never been observed (§2, §3). Writing
   `AggregatedLogProvider`'s method contract now means guessing at
   exactly the questions §10 requires the eventual design to answer
   (how DIRECT and AGGREGATED results stay distinguishable, how gaps and
   ordering are represented, how a provider's own partial-capability
   honesty is surfaced) with no real data to validate the guess against.
2. The frontend's near-zero Loki coupling (§2) means the actual
   integration cost of introducing this interface **later**, once real
   Loki evidence exists, is low — there is no tangled call site to
   untangle first, no premature scaffolding to have carried in the
   meantime, and no risk of having built the wrong shape and needing to
   rework it under time pressure.

This slice therefore stays **decision and documentation only**. This is
the smaller, more reversible of the two readings of "introduce only the
provider abstraction now" available under Option C, and it is the one
that best honors the mission's own instruction (§16) not to let this
slice's scope creep beyond a decision gate.

```
AGGREGATED_PROVIDER_IMPLEMENTED=NO — deferred pending real Loki evidence, to avoid speculative interface design against a never-observed backend
OPENSHIFT_LOKI_RETAINED=YES — unchanged, fully functional as today's standalone source
OPENSHIFT_LOKI_REMOVED=NO
```

## 6. What remains deferred, and the exact evidence required to unblock it

`OS-12` stays `OPEN_UNDECIDED` in the register (not silently closed) —
this report records the interim decision, not a final one. To justify
implementing `AggregatedLogProvider` and any product-level consolidation
in a future slice, the following evidence is required, matching the
mission's own §6 checklist:

- A real, reachable Loki endpoint (owner-supplied, the same
  sanctioned-credential pattern OS-1F used for the real OpenShift
  Sandbox — never printed/persisted).
- Verified against it: authenticated connection, TLS verification,
  `query_range` behavior, timestamp precision, service/application
  mapping, namespace/project filtering, correlation/trace/journey field
  behavior where present, a historical range genuinely beyond direct
  pod-log retention, error sanitization, raw LogQL behavior (if enabled),
  and no credential/token leakage.
- Only once that evidence exists does implementing the interface stop
  being speculative — at that point its shape can be derived from
  observed real behavior instead of guessed.

## 7. Migration implications (for the eventual consolidation, once justified)

Recorded now so the direction stays consistent whenever it resumes:

- `DirectPodLogProvider` must remain authoritative for direct/current
  logs; an aggregated provider is additive and optional, never a
  replacement.
- Aggregated-provider failure must never break Direct mode — no shared
  failure path.
- DIRECT and AGGREGATED results must never be silently merged in a way
  that creates duplicates, hidden gaps, false ordering, or ambiguous
  source origin (mission §10) — if both are ever exposed in one OpenShift
  experience, provider origin must stay visible per event.
- No duplicated parsing/masking/security logic — reuse the components
  already identified as generic (§2, `LOKI_REUSABLE_COMPONENTS`).
- Raw LogQL semantics must stay capability-gated and must never leak into
  the generic OpenShift UX by default.
- TLS verification stays mandatory; no shared-credential confusion
  between OpenShift Direct's session token and Loki's own token source.

## 8. Why `openshift-loki` is retained, not removed

Removing it now would (a) delete the only currently-functional historical
search path the product has, for zero user benefit, since nothing
replaces it in this slice, and (b) contradict the mission's own §8
default safety rule, which applies precisely because `REAL_LOKI` is
unverified — unverified is not the same as broken, and Loki's own 7-file
mock-backed test suite continues to pass, proving the *existing*,
already-shipped, separately-selectable Loki source behavior is unchanged
and uncompromised by this slice.

## 9. Security re-validation

No code changed this slice, so no new security surface exists to
validate. Re-confirmed by direct inspection (§2 `LOKI_SECURITY_COUPLING`)
that the existing, unmodified state already satisfies the mission's own
§12 checklist: Loki's token is never returned to the browser (`RawToken`
wrapper, unchanged), the OpenShift session token and Loki's token source
are architecturally separate (no shared credential state to confuse), no
trust-all TLS exists anywhere in either path, no insecure hostname
verification, no raw query/token logging (unchanged `LokiErrorClassifier`
sanitization), and raw LogQL remains capability-gated exactly as before.

## 10. Regression

Zero backend/frontend production source files changed this slice —
confirmed by `git diff --stat -- backend/src/main/java frontend/src`
returning empty. The applicable regression for a decision/docs-only
slice, per the mission's own §14, is proof that no behavior changed; an
empty production-code diff is that proof directly. A backend compile and
the existing Loki-specific test suite were re-run as additional
confirmation — see §14 in the final mission response.

## 11. Documentation

- `docs/governance/OWNER_REQUIREMENTS_REGISTER.md` — OS-12's own row
  (§12a) updated to reference this report; new §12p recording the OS-1G
  decision-gate outcome.
- `docs/architecture/OPENSHIFT_DIRECT_LOGGING_ARCHITECTURE_ASSESSMENT.md`
  — new §23 resolving open decision #1 (§22) with the real evidence
  gathered here, explicitly still `OPEN_UNDECIDED` for final consolidation.
- This report.

`HISTORICAL_DECISIONS_PRESERVED=YES` — no prior OS-A/OS-1A..1F finding
was rewritten; this report and its register/architecture-doc updates are
additive. `UNTRACKED_OWNER_REQUIREMENTS=0`.

## 12. Scope boundary (explicitly not touched)

REL-1, Final Legacy Parity / Hardening Audit, Phase M, UI/UX redesign,
branch cleanup/final baseline freeze, user-guide generation. No OpenShift
Direct behavior (OS-1A..1F) was touched. `openshift-loki` was not
removed, not redesigned, not migrated.
