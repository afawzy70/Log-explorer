# Requirements Traceability

Every item in handover §34 maps to at least one owning phase. Claude Code updates **Status** and **Evidence** in every phase; Phase M cannot pass while any row is `Not assessed` or has an unexplained gap.

**Status values:** `Not assessed` · `Present` · `Partial` · `Missing` · `Broken` · `Done` · `Deferred (reason)`
**Evidence:** file path + line, test name, or report path. Never "assumed" or "looks fine".

| # | Requirement | Handover § | Owning phase | Status | Evidence |
|---:|---|---|---|---|---|
| 1 | Problem statement understood and preserved | 1–2 | A | Present | Understood and preserved in HANDOVER.md (read in full); see docs/AUDIT.md §5 row 1. |
| 2 | Two logical sources (Docker, OpenShift Loki) | 1 | C (after A2b), D | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 2. |
| 3 | Portable Docker Compose delivery | 20 | K | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 3. |
| 4 | Remote Docker default port prefilled | 11, 20.2 | C (after A2b) | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 4. |
| 5 | Remote Docker custom port supported | 11, 24.3 | C (after A2b) | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 5. |
| 6 | Remote Docker TLS optional | 11.1, 24.2 | C (after A2b) | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 6. |
| 7 | Remote Docker reachability lesson honored (no 2375 prerequisite) | 11.2, 24.1 | C (after A2b), K | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 7. |
| 8 | Java 21 / Spring Boot 3.x / WebFlux | 4.1 | A, B | Done | backend/pom.xml (Spring Boot 3.5.16 parent, Java 21); backend/src/main/java/com/logexplorer/LogExplorerApplication.java; spring-boot-starter-webflux dependency; real `./mvnw -q verify` run (83/83 tests) and a real `java -jar` smoke boot (docs/verification/PHASE_B_REPORT.md). |
| 9 | React / TypeScript / Vite, strict TS | 4.2 | A, F | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 9. |
| 10 | No MVP database; safe localStorage only | 4.4 | B, F | Partial | Backend: no database dependency of any kind in backend/pom.xml (trivially satisfied). Frontend localStorage rule not yet applicable - no frontend exists (owned by Phase F). |
| 11 | Single deployable image, SPA fallback excludes /api and actuator | 4.3 | K | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 11. |
| 12 | Canonical top-level fields mapped | 5, 5.1 | B | Done | backend/src/main/java/com/logexplorer/core/parse/LogLineParser.java; LogLineParserTest#mapsAllCanonicalTopLevelFields (23 parser tests total, all passing). |
| 13 | All expected MDC fields handled | 5 | B | Done | LogLineParser.java mdc extraction; LogLineParserTest#mapsAllCanonicalMdcFields. |
| 14 | Literal dotted key `event.correlationId` read safely | 5.1 | B | Done | LogLineParser#resolveCorrelationId uses Map.get("event.correlationId") literally; LogLineParserTest#correlationLiteralKeyIsNotMistakenForANestedPath explicitly proves a nested {event:{correlationId}} shape is NOT picked up. |
| 15 | Correlation precedence (X-Correlation-id → event.correlationId) | 5.1 | B | Done | LogLineParser#resolveCorrelationId; LogLineParserTest#correlationPrefersHeaderKeyWhenBothPresent, #correlationFallsBackToLiteralDottedKeyWhenHeaderAbsent. |
| 16 | Unknown JSON/MDC fields preserved | 5.3 | B | Done | CanonicalLogEvent.unknownTopLevelFields/unknownMdcFields; LogLineParserTest#preservesUnknownTopLevelFields, #preservesUnknownMdcFields, #unknownMdcFieldsNeverContainAnyOfTheFiveSensitiveKeys. |
| 17 | Malformed lines become raw fallback events | 5.4 | B | Done | LogLineParser#malformed(); LogLineParserTest#malformedNonJsonLineBecomesRawFallbackEvent, #jsonArrayInsteadOfObjectBecomesRawFallbackEvent, #nullLineBecomesRawFallbackEventWithoutThrowing. |
| 18 | Timestamp normalization to Instant, no double conversion | 5.5 | B | Done | LogLineParser#parseTimestamp (OffsetDateTime/Instant parsing, keeps timestampRaw always); LogLineParserTest#acceptsVariousTimestampOffsetsAndNormalizesToUtcInstant (parameterized, 4 offset shapes). |
| 19 | Sensitive field masking before browser serialization | 6.1 | B | Done | core/mask/MaskingService.java (single boundary, applied in api/EventMapper.java before DTO construction); MaskingServiceTest (19 tests incl. boundary cases); SerializationLeakTest proves masking is applied before serialization. |
| 20 | Never log search values, tokens, raw identifiers, events | 6.2 | B + every phase | Partial | Phase B: SerializationLeakTest + LogLeakTest (real Logback capture across success/guardrail-violation/unknown-source paths, response body AND logs both checked, real WebClient/Netty TRACE wire-logging leak found and fixed via logging.level pins in application.yml). Ongoing responsibility for every later phase per HANDOVER.md §6.2 - not yet 'Done' project-wide. |
| 21 | Safe text rendering; no dangerouslySetInnerHTML | 6.3 | G, H | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 21. |
| 22 | Explicit source capability model | 7 | B | Done | core/model/SourceCapabilities.java; returned via GET /api/v1/sources (SourcesController.java); SourcesApiIntegrationTest#sourcesEndpointReturnsExplicitCapabilitiesJson. |
| 23 | Source registry and API endpoints | 7 | B | Done | source/LogSource.java (SPI), source/LogSourceRegistry.java (stable-ID resolution, unknown/disabled -> sanitized ProblemDetail); LogSourceRegistryTest (5 tests); SourcesApiIntegrationTest (404 cases). |
| 24 | Bounded query guardrails | 8.1 | B | Done | core/guard/SearchGuardrails.java; SearchGuardrailsTest (12 tests: missing/invalid/oversized range, limit validation and clamping). |
| 25 | Per-source maximum time range | 8.1 | B | Done | SearchGuardrailsProperties#perSourceMaxTimeRange (Map<String,Duration>, config-driven, no hardcoding); SearchGuardrailsTest#perSourceMaxTimeRangeOverridesTheDefaultAndIsEnforced, #perSourceMaxTimeRangeCanBeMorePermissiveThanTheDefault. |
| 26 | Result limit with configurable max (≤ 5,000) | 8.1 | B | Done | SearchGuardrailsProperties#maxLimit (default 5000, matching HANDOVER.md §8.1's "<=5000"); SearchGuardrailsTest#limitAboveConfiguredMaxIsClampedNotRejected. |
| 27 | Bounded concurrency | 8.1 | B | Done | core/guard/ConcurrencyGuard.java (non-blocking Semaphore, releases on complete/error/cancel); ConcurrencyGuardTest (3 tests); SearchServiceTest#concurrencyCapIsEnforcedAcrossSearchesOnTheSameSource. |
| 28 | Cancellation propagated | 8.1, 18.2 | B, J | Partial | Phase B (search cancellation): ConcurrencyGuard#guard releases on doFinally incl. cancel; SearchServiceTest#cancellationPropagatesDownToTheUnderlyingSource proves cancellation reaches the LogSource. Phase J (live-tail cancellation) not yet done. |
| 29 | Simple deterministic query DSL (no eval/SpEL/reflection) | 9 | E | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 29. |
| 30 | Raw LogQL gated: Loki-only, off by default, config-enabled, bounded | 9.1 | E | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 30. |
| 31 | Docker Compose label discovery + service counts | 10 | C (after A2b) | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 31. |
| 32 | Docker stream framing decoded correctly (incl. tty) | 10 | C (after A2b) | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 32. |
| 33 | Docker operations strictly read-only | 10 | C (after A2b) | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 33. |
| 34 | OpenShift Loki gateway adapter, query_range semantics | 12 | D | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 34. |
| 35 | Gateway prefix / tenant / namespace + service label keys configurable | 12 | D | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 35. |
| 36 | TLS verification enabled for Loki; no trust-all | 6.5, 12 | D | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 36. |
| 37 | Compact professional shell, one title, health + retry | 13.1 | F | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 37. |
| 38 | Accessible searchable service multi-select | 13.3 | F | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 38. |
| 39 | Severity default INFO/WARN/ERROR; not color-only | 13.4 | F | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 39. |
| 40 | Universal search with confirmable ID detection | 13.5 | F | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 40. |
| 41 | Advanced filters grouped by question, draft/apply/cancel, protected wording | 13.6 | F | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 41. |
| 42 | Time presets include Last 1 day | 14.1 | F | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 42. |
| 43 | Zero-result one-click "Search last 1 day" | 14.1 | F, G | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 43. |
| 44 | Custom range popover: prefill, Apply/Cancel, close, focus restore, real interval label | 14.2 | F | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 44. |
| 45 | Display zone shown (e.g. Asia/Kuwait UTC+03:00) | 14.2 | F | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 45. |
| 46 | Display zone → UTC converted exactly once | 14.2, 24.9 | F | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 46. |
| 47 | Time validation distinguishes all four error classes | 14.2 | F | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 47. |
| 48 | Exactly seven columns in exact order | 15.1 | G | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 48. |
| 49 | Missing values render `—`; no omitted cells | 15.1, 24.5 | G | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 49. |
| 50 | One semantic table, one colgroup, fixed layout, shared geometry | 15.2, 24.4 | G | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 50. |
| 51 | Actions is the seventh cell of the same row | 15.3, 24.7 | G | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 51. |
| 52 | Message renders under "What happened", not Service | 15.1, 24.6 | G | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 52. |
| 53 | Newest-first sort; no dropped or duplicated rows | 15.6 | G | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 53. |
| 54 | One pagination model only | 15.7 | G | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 54. |
| 55 | Truthful, non-contradictory counts | 15.8, 24.10 | G | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 55. |
| 56 | ≤2px header/cell geometry verification at all viewports and zoom | 15.9 | G | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 56. |
| 57 | Loading state | 27.6 | G | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 57. |
| 58 | Error state | 27.6 | G | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 58. |
| 59 | Empty state | 27.6 | G | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 59. |
| 60 | Cancelled state | 27.6 | G | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 60. |
| 61 | Partial / truncated state | 8.1, 27.6 | G | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 61. |
| 62 | Event inspector layout, resize, prev/next/close, focus | 16 | H | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 62. |
| 63 | Local timestamp with ms + named zone, plus UTC | 16.2 | H | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 63. |
| 64 | Protected actor & client section, no reveal action | 16.3 | H | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 64. |
| 65 | Request-flow section with safe copy and related-log actions | 16.4 | H | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 65. |
| 66 | Business/error section with formatted exception | 16.5 | H | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 66. |
| 67 | All-fields view with raw JSON behind disclosure | 16.6 | H | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 67. |
| 68 | Show ±30 seconds context, scoped, bounded, with breadcrumb | 16.7 | H | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 68. |
| 69 | Trace investigation | 17 | I | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 69. |
| 70 | Correlation investigation | 17 | I | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 70. |
| 71 | Journey investigation across multiple traces | 17 | I | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 71. |
| 72 | JMS / event correlation metadata displayed | 17 | I | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 72. |
| 73 | Timestamp order stated as not guaranteed causality | 17 | I | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 73. |
| 74 | Previous search state preserved and restorable | 17 | I | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 74. |
| 75 | SSE live transport; no tokens or sensitive filters in URL | 18.1 | J | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 75. |
| 76 | Docker upstream cancellation on disconnect | 18.2 | J | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 76. |
| 77 | Loki live capability gated honestly; no faking | 18.3, 24.14 | D, J | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 77. |
| 78 | Bounded backend buffer, heartbeat, timeout, max concurrent tails | 18.4 | J | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 78. |
| 79 | Bounded frontend buffer | 18.4 | J | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 79. |
| 80 | Initial displayed-live cap of 1,000 events | 18.4 | J | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 80. |
| 81 | Start / pause / resume / stop lifecycle, unmount closes stream | 18.4 | J | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 81. |
| 82 | Dropped and buffered counts visible | 18.4 | J | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 82. |
| 83 | Responsive at 1920/1440/1280/1024/768/390 | 19.2, 28 | F–H, M | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 83. |
| 84 | Accessibility to WCAG 2.2 AA principles | 19.4 | F–J | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 84. |
| 85 | Zoom/reflow at 125% / 200% and targeted high zoom | 28 | F, G | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 85. |
| 86 | No page-level horizontal overflow | 15.2, 19.4 | G | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 86. |
| 87 | Centralized design tokens; restrained visual language | 19.3 | F | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 87. |
| 88 | No fabricated branding or production-readiness claims | 3 | F, M | Present | README.md:1-2 is neutral ('Log Explorer...'); no branding/logo/affiliation/production claims found anywhere in repo. docs/AUDIT.md §5 row 88. |
| 89 | Non-root runtime image, multi-stage, no build secrets | 4.3, 21 | K | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 89. |
| 90 | Docker socket mount only behind explicit Compose profile | 20.1 | K | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 90. |
| 91 | Docker socket privilege warning documented | 20.1 | K | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 91. |
| 92 | `.env.example` with names and harmless defaults only | 6.4 | K | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 92. |
| 93 | Portable run/requirements guide matching real commands | 20 | K | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 93. |
| 94 | Deterministic smoke tests (build→start→health→discover→search→UI→stop→cleanup) | 20 | K | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 94. |
| 95 | OpenShift manifests (Deployment, Service, Route, ConfigMap, ServiceAccount) | 21 | L | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 95. |
| 96 | No cluster-wide RBAC; namespace-scoped binding documented only | 21 | L | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 96. |
| 97 | Secret references only; no committed secrets | 21 | L | Partial | No committed secret values found in full git history scan (docs/AUDIT.md §6); but no deploy/ manifests exist yet to apply the 'Secret references only' pattern to. docs/AUDIT.md §5 row 97. |
| 98 | Independent verification per phase, not compilation | 22 | all, M | Present | This audit reports real command output incl. failures (docs/AUDIT.md §3) rather than compilation-as-proof. docs/AUDIT.md §5 row 98. |
| 99 | Recovery process after verification failure | 22.2 | all | Present | Recovery process defined in PHASE-PROMPTS.md and IMPLEMENTATION-PLAN.md §7 per-phase Recovery sections. docs/AUDIT.md §5 row 99. |
| 100 | PASS / FAIL / BLOCKED / DEFERRED honesty | 22.1, 24.15 | all | Present | Applied throughout docs/AUDIT.md (FAIL/BLOCKED reported honestly, not converted to PASS). docs/AUDIT.md §5 row 100. |
| 101 | Final stakeholder acceptance tasks 1–6 | 27 | M | Missing | Absent — repo contains no application code (backend/ and frontend/ do not exist). docs/AUDIT.md §5 row 101. |
| 102 | Deferred items and non-goals preserved, not implemented | 25 | M | Present | No out-of-scope capability found anywhere in repo (trivially true — no code exists at all). docs/AUDIT.md §5 row 102. |

---

## Superseded decisions — confirm each was applied, not reverted

| Decision | Applied? | Evidence |
|---|---|---|
| Remote Docker TCP is optional, never a prerequisite | N/A yet | No Docker adapter code exists to apply this to (docs/AUDIT.md §5 rows 4-7). Owning phase C. |
| Remote Docker TLS optional (but never trust-all) | N/A yet | No Docker adapter code exists (docs/AUDIT.md §5 row 6). Owning phase C. |
| Remote Docker default port prefilled and overridable | N/A yet | No Docker adapter code exists (docs/AUDIT.md §5 rows 4-5). Owning phase C. |
| Portable Compose is a first-class deployment mode | N/A yet | No Dockerfile/docker-compose.yml exist (docs/AUDIT.md §5 row 3). Owning phase K. |
| Live OpenShift verification is DEFERRED, not a release blocker | N/A yet | No Loki adapter exists yet to attempt live verification against (docs/AUDIT.md §5 row 34). Owning phase D. |
| Raw LogQL is off by default and not a dominant disabled control | N/A yet | No query engine or UI exists (docs/AUDIT.md §5 row 30). Owning phase E. |
| One deployable image with SPA fallback excluding /api and actuator | N/A yet | No Dockerfile/backend config exists (docs/AUDIT.md §5 row 11). Owning phase K. |
| Committed custom time interval is displayed literally | N/A yet | No time-range UI exists (docs/AUDIT.md §5 row 44). Owning phase F. |

---

## Out-of-scope confirmation (Phase M)

Confirm none of the following were implemented, and record where any pre-existing instance was found during Phase A:

SSO / per-user OAuth · long-term log storage · SIEM · alerting · full APM · log mutation · cross-source single query · application database · cluster-wide permissions · query audit persistence · HA / horizontal scale · saved or team queries · retention / DR · scheduled queries · tracing-backend integration · pseudonymized lookup service · multi-cluster queries · penetration testing / production approval · AI root-cause diagnosis · analytics · production identity features.

**Phase A finding:** none of the above were found anywhere in the repository. This is trivially true rather than a validated guarantee: the repository contains no application code at all (see docs/AUDIT.md §2, §7), so there is nothing — in scope or out of scope — for any of these to exist within. Re-confirm this row at Phase M once actual implementation exists to check against.
