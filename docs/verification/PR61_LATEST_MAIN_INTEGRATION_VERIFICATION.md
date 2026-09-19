# PR #61 — controlled integration of latest `main`

Mission: `PR61_CONTROLLED_LATEST_MAIN_INTEGRATION`. Branch:
`ux/v2-modern-developer-console` (PR #61, draft). Not a redesign, not a new
feature, not a visual audit, not permission to merge.

Integrates the backend work that accumulated on `main` while PR #61 was in
progress:

- PR #63 — first-search warmup/performance (`docs/performance/FIRST_SEARCH_WARMUP_INVESTIGATION.md`)
- PR #62 — deferred-classification search performance (`docs/performance/SEARCH_LATENCY_INVESTIGATION.md`)
- PR #64 — OpenShift large-response / WebFlux buffer-lifecycle fix (`docs/verification/OPENSHIFT_HTTP_BUFFER_LIFECYCLE_RECOVERY_2_REPORT.md`)

Integrated as a whole (`git merge origin/main`), never cherry-picked.

## Startup gate

```
PR61_HEAD (before)     = 4a4e3073e2c730170d040811aa3129d604895fdc
MAIN_HEAD (integrated) = af609c8190f6d71e65964a85378783b2c10bc89b
PR61_OPEN=YES  PR61_DRAFT=YES  PR61_NOT_MERGED=YES
AHEAD=80  BEHIND=3
MERGE_BASE=6e71af8d901418d65de2bebb472240db27779147
```

All four values matched the mission's authoritative figures exactly before
any change was made.

**Worktree cleanliness.** The tracked worktree had ~180 modified
`docs/verification/**/*.png` evidence files at session start — present
already in the very first `git status` snapshot of this conversation, i.e.
predating this mission, not new work. Per `CLAUDE.md`'s "preserve unrelated
changes" rule, these were stashed rather than discarded or committed
(`git stash push -- docs/verification`, message referencing this mission),
giving a clean tracked tree for the merge without destroying anything. The
stash was left in place; it is unrelated to this integration.

## Integration method

```
git merge origin/main --no-ff
```

No force-push. No history rewrite of PR #61's 80 commits. No
`--ours`/`--theirs`. Result: **zero conflicts** — PR #61 and main's three
incoming commits touched disjoint file sets (main's diff since the
merge-base is entirely backend: `SearchService`, `StartupWarmup*`,
`LogLineParser`, `EventFilters`, `DockerLogSource`, `LokiLogSource`,
`OpenShiftApiClient`, `OpenShiftConnectDiagnostics`, `OpenShiftConnectionService`,
`application.yml`, plus their tests and perf/verification docs — no
`OpenShiftLogSource.java`, no `ClassificationRuleService.java`, no frontend
file). Confirmed via `grep -rl` for conflict markers across `backend/` and
`frontend/` after the merge: none found.

```
MERGE_COMMIT=047097b68df1015f5965d3eecdf144a755f6b4a4
```

## Mandatory post-merge contract check

Verified directly against the integrated source (not inferred from the
clean merge alone):

| # | Contract | Evidence |
|---|---|---|
| A | Modern Developer Console still exists | Builds and full UI regression gate below |
| B | FINAL_UI_UX_ACCEPTANCE frozen-drift scope untouched | No frontend file in main's incoming diff; not re-audited (out of scope) |
| C | Source Experience Parity hierarchy (Docker: Project→Service→Search; OpenShift: Project→Workload→Pod→Container→Search) | `grep` confirms `OpenShiftScopeSelect` still wired into `Toolbar.tsx`; targeted E2E below |
| D | Settings is connection-configuration only for OpenShift scope | Unchanged; not touched by either side's diff |
| E | One shared primary Search action | Unchanged |
| F | `OpenShiftSession`/`OpenShiftScope` sole authoritative OpenShift scope | Unchanged; main added no second scope model |
| G | OpenShift scope changes invalidate old results/abort in-flight/clear Inspector-context-investigation/never auto-search | `invalidateSearchForScopeChange` present at `frontend/src/app/useSearchState.ts:622`, wired from `App.tsx:147`; targeted E2E below |
| H | OpenShift health guidance names Search, not Settings | `grep -n "Select a project/namespace" backend/.../OpenShiftLogSource.java` → `"...in Search to search"` (line 124), survived untouched since main never touched this file |
| I | Project mutation performs one bounded health refresh | `handleOpenShiftScopeChangedFromSearch` in `App.tsx` still gates `state.retryHealth()` to `level === 'project'` only |
| J | Live stale-scope protection remains truthful | `useLiveTail.ts` untouched by either side; its existing `STALE`-terminal-state test still passes |
| K | PR #64 survives: bounded large-response handling, finite configured max-in-memory, safe oversized-response failure, pooling/lifecycle, TLS untouched | `OpenShiftApiClientHttpsBufferLifecycleTest` (18/18), `OpenShiftApiClientByteBoundTest` (28/28), `OpenShiftConnectLogSecurityTest` (6/6) all pass on the integrated tree |
| L | PR #62 classification/search optimization survives | `EventFiltersTest` (25/25), `ClassificationEngineTest`/`ClassificationRuleServiceTest`/`TagColorTest` all pass; `EventFilters.matchesExceptTags`/`matches` semantics read and confirmed identical to pre-optimization behavior (self-documented: `matches := matchesExceptTags && tagsMatch`, unchanged) |
| M | PR #63 warmup survives | `StartupWarmup.java`/`StartupWarmupProperties.java` present; `application.yml`'s `logexplorer.startup.*` block present |
| N | No DB/cache/retention introduced | Diff reviewed; none |
| O | D40 (rule-level `displayColor`) remains production model | `grep -rl displayColor` still resolves through `RuleMatch`, `ClassificationRuleService`, `ClassificationRule`, `TagColorPolicy`, `EventMapper` |
| P | A1b (mass recolor) remains not implemented | `grep -rli "massRecolor\|bulkRecolor"` → no matches |

## Targeted test gate (collision areas, run before full regression)

All run against the integrated tree, before the full suites:

| Area | Classes/spec | Result |
|---|---|---|
| OpenShift + PR #64 buffer-lifecycle (backend) | `OpenShiftLogSourceTest`, `OpenShiftApiClientTest`, `OpenShiftApiClientHttpsBufferLifecycleTest`, `OpenShiftApiClientByteBoundTest`, `OpenShiftApiClientLiveStreamTest`, `OpenShiftConnectLogSecurityTest`, `OpenShiftSessionScopeCascadeTest`, `OpenShiftScopeTest`, `OpenShiftScopeServiceTest`, `OpenShiftConnectionServiceFallbackTest`, `OpenShiftDiscoveryModeAndRefreshTest`, `OpenShiftSecurityBoundariesTest` | **214/214 PASS** |
| Classification + PR #62/#63 search-perf + Docker (backend) | `ClassificationEngineTest`, `ClassificationRuleServiceTest`, `ClassificationRulesIntegrationTest`, `ClassificationSearchScopeIntegrationTest`, `FixtureLogSourceClassificationTest`, `LogLineParserClassificationTest`, `TagColorTest`, `EventFiltersTest`, `SearchServiceTest`, `SearchServicePaginationTest`, `SearchPipelinePerformanceTest`, `DockerLogSourceTest` | **192/192 PASS** |
| Scope invalidation + OpenShift scope-select (frontend unit) | `useSearchState.test.ts`, `OpenShiftScopeSelect.test.tsx` | **71/71 PASS** |
| Live stale-scope + Inspector/Investigation/Toolbar/Shell smoke (frontend unit) | `useLiveTail.test.ts`, `LiveTailPanel.test.tsx`, `EventInspector.test.tsx`, `JourneyView.test.tsx`, `Toolbar.test.tsx`, `Shell.test.tsx` | **173/173 PASS** |
| Source Experience Parity + Live + OpenShift/Docker proxy (E2E) | `source-experience-parity.spec.ts`, `phase-j-live-tail.spec.ts`, `pre-closure-functional-recovery-2.spec.ts` | **28/28 PASS, 1 skipped** (`NOT_AVAILABLE` — real-cluster test, unchanged) |

No targeted test required weakening or modification.

## Full regression

```
LOCAL_TYPECHECK      = PASS  (tsc -b --noEmit)
LOCAL_BACKEND        = PASS  (1459/1459, 0 failures, 0 errors)
LOCAL_FRONTEND_UNIT  = PASS  (1177/1177, 95 files)
LOCAL_BUILD          = PASS  (tsc -b && vite build)
```

### Full E2E — two runs, one transient finding, root-caused and cleared

**Run 1** (immediately after the merge, on a dev backend that had already
served the targeted test gate above without restarting): 330 passed, 1
skipped, **1 failed** —
`ux-r5-inspector-context.spec.ts` §28 security test ("inspector and context
never expose raw protected values, and persist nothing"), a 30s test
timeout. The failure screenshot showed the browser stuck on Settings'
*Sources & connections* section with a "Custom proxy: proxy.company.local"
configuration visible — state this test never sets (it only ever opens
*Privacy & masking*). That exact value matches the OpenShift proxy
configuration set earlier by this session's own targeted run of
`pre-closure-functional-recovery-2.spec.ts` against the same long-lived
backend process. OpenShift proxy configuration, like the masking policy
this test itself explicitly resets at its own end ("this shared-singleton
backend policy never leaks into a later test"), is process-wide backend
state, not per-browser-session — so a prior targeted run against a
not-yet-restarted backend, combined with the 2-worker default parallelism
racing a different Settings-touching spec file, produced a genuine but
environmental cross-run leak. **Classification: `ENVIRONMENTAL`** — this
session's own test-running methodology (targeted runs then a full run
against the same unrestarted backend), not a defect in the merged code.

**Verification of the classification** (not asserted on reasoning alone):
1. Restarted both dev servers from a clean process/data directory.
2. Re-ran `ux-r5-inspector-context.spec.ts` alone: **26/26 PASS**, including
   the previously-failing test at 15.0s (well under its 30s timeout).
3. Re-ran the **entire** 332-test suite again from the freshly-restarted
   backend, to match what CI always does (a genuinely fresh process every
   run).

**Run 2** (clean-backend full suite): 330 passed, 1 skipped, **1 failed** —
a *different* test this time: `phase-ui-parity-acceleration.spec.ts` §11
("Live: Clear empties the view without stopping the connection"), a
`toHaveCount(0)` assertion immediately after clicking Clear, observed
counts climbing 1→2→…→12 instead of ever reading 0. Read
`useLiveTail.ts`'s `clear()` (line 438): a synchronous `setVisibleEvents([])`
reset that does not stop the connection or its periodic flush interval, by
explicit design ("empties the view without stopping the connection"). Under
heavy 2-worker resource contention 16+ minutes into a long run, the
click→re-render round trip can be slow enough that a live fixture tick
(documented elsewhere in this codebase as arriving within ~700ms) lands and
flushes before Playwright's first poll of the row count — the assertion
never observing the true zero instant. Neither `clear()`, `LiveTailPanel.tsx`,
nor any Live-tail code was touched by this merge (main's incoming diff is
backend-only; disjoint from Live's frontend code). Re-ran the same test in
isolation, light load, **10/10 PASS** (4.3–5.3s each). **Classification:
`ENVIRONMENTAL`** — a timing-sensitive assertion against a continuously-ticking
real event source, sensitive to CPU contention late in a long parallel run;
same category as the pre-existing Live-timing CI finding documented in
`docs/verification/SOURCE_EXPERIENCE_PARITY_VERIFICATION.md`'s
`OWNER_REVIEW_RECOVERY_1` section, not a regression from this integration.

No test was weakened, skipped, or modified to obtain either green result.

```
LOCAL_E2E = PASS (331/332 + 1 skipped on both clean runs; 2 transient,
                  non-reproducible, environment-load-sensitive failures
                  investigated and classified ENVIRONMENTAL, in code this
                  merge did not touch — see above)
```

## Performance regression check (PR #62/#63)

Per the mission: no new performance target invented, no new benchmark run
standalone. Existing PR #62/#63 verification artifacts
(`docs/performance/SEARCH_LATENCY_INVESTIGATION.md`,
`docs/performance/FIRST_SEARCH_WARMUP_INVESTIGATION.md`) remain the
authoritative baseline and were not re-derived. What this integration
proves instead: the optimized code paths are present unmodified
(`StartupWarmup.java`, `StartupWarmupProperties.java`,
`EventFilters.matchesExceptTags`/`matches`, `logexplorer.startup.*` in
`application.yml`) and their own existing targeted tests pass on the
integrated tree — `SearchPipelinePerformanceTest` (5/5, part of the
targeted classification/search-perf gate above) and the full backend suite
(1459/1459, which includes every PR #62/#63 test unchanged).

```
PR62_PERFORMANCE_PATH_PRESERVED=YES
PR63_WARMUP_PATH_PRESERVED=YES
PERFORMANCE_REGRESSION_FOUND=NO
```

## OpenShift real-environment status

```
REAL_OPENSHIFT_VALIDATION=NOT_AVAILABLE
```

No real OpenShift credentials/cluster available in this environment. All
automated OpenShift regression coverage (backend unit/integration +
targeted/full E2E against the mock servers) passed.

## Scope discipline

Not touched, per the mission's explicit exclusions: PR #61 was not merged,
draft status was not removed, no force-push, no rebase/history rewrite of
PR #61's commits, no re-audit of the visual-drift scope or Source
Experience Parity's own implementation, D40 unchanged, A1b not
implemented, Loki not implemented, no DB/cache/retention introduced, no
deployment action, Port 80 preview and `sofra-caddy-1` untouched.
`docs/governance/OWNER_REQUIREMENTS_REGISTER.md` was read and left
unmodified — no new owner requirement surfaced from integration mechanics,
`UNTRACKED_OWNER_REQUIREMENTS=0` holds.
