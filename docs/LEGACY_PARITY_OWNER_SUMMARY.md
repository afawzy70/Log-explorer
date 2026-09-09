# Legacy Parity — Owner Summary

**One-paragraph verdict:** The NEW Log Explorer is architecturally sound, better-tested, and
already exceeds the OLD app in several real ways (bounded-buffer sizing, real journey endpoint,
honest capability reporting, automated a11y/geometry regression gates, a functioning-not-dead raw
LogQL backend). It has real, verified gaps against OLD's product surface — most seriously: search
results silently cap at 200 events with no way to see more; live tail cannot recover from a
transient disconnect; there is no in-app way to change the Docker connection without restarting
the app; and there is no free-form/guided query-building path once structured filters aren't
enough. None of these are architectural flaws — every one is a missing or unwired integration on
top of correct underlying logic, and a concrete, phased plan exists to close them without copying
OLD's implementation.

---

## What this document is

A short digest of `docs/LEGACY_TO_NEW_VERIFIED_CAPABILITY_MATRIX.md` (full evidence),
`docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md` (the fix plan), `docs/LEGACY_UX_PARITY_REPORT.md`, and
`docs/LEGACY_BACKEND_PARITY_REPORT.md`. Read this first; go to the detailed reports for evidence
behind any claim here.

## Top things NEW already does better than OLD (keep these, don't regress them)

1. **Never-lose-context investigation views** — journey/context views are structurally pure
   overlays that cannot mutate the underlying search, unlike OLD's save/restore pattern.
2. **A real, working raw-LogQL backend path** — OLD's own raw LogQL is a dead path (force-disabled
   in its own constructor); NEW's is genuinely wired end-to-end, just missing a UI control.
3. **A real dedicated journey/timeline endpoint**, removing the risk of client-side truncation on
   large traces that OLD's client-only assembly is exposed to.
4. **Automated, permanent regression gates** for table geometry (≤2px), accessibility (jest-axe
   across 20+ components), and responsive layout at 6 viewports — OLD's equivalent checks are
   manual QA checklist items, not automated gates.
5. **A found-and-fixed live-tail backpressure crash bug** that OLD's own audit never identifies as
   a risk in OLD's own code — NEW's reactive pipeline received more adversarial testing.
6. **More generous, still-bounded limits** — 2000 lines/container vs OLD's 200; 500-entry live
   server buffer vs OLD's 256.
7. **Honest, structurally-enforced capability reporting** — a source's capabilities can never
   silently drift out of sync with the frontend the way OLD's static `KNOWN_SOURCES` model can.
8. **Stronger security posture in two concrete ways already**: no reveal/unmask path exists at
   all (removing a whole class of risk OLD's own audit flags as a no-auth concern), and a real,
   automated OpenShift-manifest RBAC/secret check exists that OLD has no equivalent of.

## Top gaps that matter (in priority order — value, not ease)

**P0**
- Search results are invisibly capped at the first page (~200 events); "Load more" is built but
  structurally unreachable because no adapter ever populates a next-page cursor. This blocks real
  investigation on any result set larger than the default limit. → **Remediation Slice 1.**

**P1**
- Live tail cannot recover from a transient disconnect — a network blip silently ends a monitoring
  session with no reconnect, where OLD had a bounded, self-healing retry. → **Slice 5.**
- No in-app way to change or test a Docker connection at runtime — every change requires an app
  restart, and remote connections lack OLD's SSRF/DNS-rebinding protection. → **Slice 3.**
- No guided or free-text query-building path once structured filters aren't expressive enough —
  the backend grammar is complete and tested, but nothing in the UI can reach it. → **Slice 2.**
- Free-text log message/exception content is never scanned for embedded secrets/PII, unlike OLD's
  text-redaction pass — a real defense-in-depth gap. → **Slice 7.**
- Log Explorer's own container isn't excluded from its own Docker discovery results, confirmed
  live. → **Slice 3.**

**P2**
- No Refresh button, no generated-query/push-down transparency disclosure, no global Ctrl+Enter,
  no live follow-newest/Clear, no gap markers in the journey timeline, flatter source-health
  messages, no safe non-sensitive preference persistence (source/preset/severity), no
  code-splitting. → **Slices 1, 2, 5, 6, 8.**

**P3 / owner decision needed, not simply "build it"**
- Whether to reintroduce optional/reorderable/dense result columns (OLD had 13 configurable
  columns; NEW deliberately fixed 7 per `CLAUDE.md`) — this needs an explicit policy call, not an
  engineering decision (**OD-1** in the remediation plan). If declined, this whole area is
  correctly `SUPERSEDED_BY_OWNER_DECISION`, not a gap.
- Whether live tail should require a pre-start confirmation dialog like OLD's, or NEW's one-click
  start is an acceptable simplification (**OD-2**).
- A handful of items neither app has (export, saved presets) — worth a "still out of scope?" check
  but not a regression either way.

## What was explicitly *not* carried forward, and why that's correct

- OLD's HMAC keyed-token sensitive-field matching → NEW's direct raw-value-server-side-only
  comparison achieves the identical security guarantee with a simpler mechanism. Not a gap.
- OLD's session-scoped, no-auth, gated-off unmask capability → `CLAUDE.md` already forbids any
  reveal action for masked values; NEW's total absence of a reveal path is the more secure,
  already-approved posture, not a missing feature.
- OLD's per-user session Docker-connection header (anonymous, no auth) → the remediation plan
  proposes a safer, admin-changeable runtime connection instead of resurrecting an unauthenticated
  session mechanism.

## Two real bugs found and already fixed during this reconciliation itself

Both predate this reconciliation (found during Phase M's UX acceptance pass and a real user bug
report) and are already on `main`, included here because the matrix reflects NEW's *current* state:
1. Malformed/edge-case events were being silently excluded by the default severity filter.
2. A null-valued unknown JSON field could throw an `NullPointerException` during parsing.

## Scope note

This reconciliation and its four companion documents are **plan and evidence only**. No
remediation code has been written. Per the mission's explicit instruction, implementation begins
only after the owner and reviewer approve the remediation plan — including resolving OD-1 and
OD-2 above, which block one slice each.

---

## Final report

```
TOTAL_OLD_CAPABILITIES=99
FULL_IN_NEW=48
PARTIAL_IN_NEW=14
MISSING_IN_NEW=25
NEW_BETTER=17
SUPERSEDED=6
UX_REGRESSIONS=7
BACKEND_REGRESSIONS=9
NEEDS_LIVE_VERIFICATION=0
OWNER_DECISIONS_REQUIRED=5

TOP_P0_GAPS:
1. Search pagination structurally unreachable — results silently cap at ~200 events (TABLE-08, Slice 1)

TOP_P1_GAPS:
1. Live-tail reconnect entirely missing — a transient disconnect ends the session (LIVE-06, Slice 5)
2. No in-app Docker connection configurability/test action, plus missing SSRF/DNS-rebinding protection on remote connections (SRC-04/05/10, Slice 3)
3. No guided or raw-text query-building UI despite a complete, tested backend grammar (SEARCH-06/07/10, Slice 2)
4. No free-text redaction of secrets/PII embedded in message/exception content (MASK-07, Slice 7)
5. No Docker self-exclusion label support — Log Explorer's own container appears in its own discovery (SRC-09, Slice 3)

TOP_UX_REGRESSIONS:
1. Live-monitoring a service cannot survive a network blip without manual restart (Task 10)
2. Configuring a remote Docker connection requires an app restart and lacks a Test action (Tasks 11-12)
3. Refining an investigation beyond structured filters has no incremental query-building path (Task 15)
4. No 30-minute time preset matching OLD's default investigation window (Task 1)
5. Source-health failure messages are less specific than OLD's reason-categorized guidance (Task 14)

TOP_BACKEND_GAPS:
1. Query-plan transparency (generated LogQL, push-down/post-filter reporting) computed but never exposed in any response
2. No adapter populates a real next-page cursor or a distinct estimated-total count
3. No settings API surface (Docker connection, masking status) despite the underlying config models existing
4. Live-tail concurrency cap (4) is lower than OLD's (10) — a config value, trivially raised
5. Live-tail filtering by severity/text is not threaded through, only service

TOP_NEW_IMPROVEMENTS_TO_PRESERVE:
1. Structurally pure-overlay journey/context views that cannot lose or mutate the underlying search state
2. Real, working raw-LogQL backend path (OLD's own is a dead, force-disabled path)
3. Dedicated server-side journey endpoint avoiding client-side truncation risk on large traces
4. Automated regression gates for table geometry, accessibility, and responsive layout that OLD only checks manually
5. No reveal/unmask capability anywhere, removing a no-auth risk class OLD's own audit flags

READY_FOR_REMEDIATION_PLAN_REVIEW=YES
```
