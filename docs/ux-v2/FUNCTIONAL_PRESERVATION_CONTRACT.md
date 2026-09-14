# Functional Preservation Contract — UX v2

This is the non-negotiable floor for the UI/UX v2 redesign. The redesign
may change *how* every item below looks, is composed, is navigated to,
and is disclosed. It may **never** change *whether* it works, remove it,
weaken it, or make it behave differently from what the frozen functional
baseline (`functional-baseline-pre-ux-redesign`,
`ed6dbf578451f0ebca4e769b9b04af7137937031`) already guarantees.

```
FUNCTIONAL_BEHAVIOR_LOSS_ALLOWED=NO
```

Every item below is traceable to the current baseline's own
documentation (`docs/user-guide/USER_GUIDE_EN.md`,
`docs/user-guide/CAPABILITY_MATRIX.md`) or governing rules
(`CLAUDE.md`). Where this contract and a design direction conflict, the
contract wins — a direction must be revised, not the contract weakened,
without an explicit, named owner decision recorded in
`docs/governance/OWNER_REQUIREMENTS_REGISTER.md` (CLAUDE.md §5's "named
conflict" discipline applies here too).

---

## 1. Sources

- Exactly four sources: **Fixture**, **Docker**, **OpenShift**,
  **OpenShift Loki** — no source may be removed, merged, or renamed in a
  way that changes what it refers to.
- The backend declares capability (`SourceCapabilities`); the frontend
  **never infers** what a source can do from its name or type. A
  redesign must preserve this: a control's presence is always driven by
  the declared capability, never a design-time assumption. See
  `docs/user-guide/CAPABILITY_MATRIX.md` for the exact current matrix —
  it must remain accurate after the redesign, or be explicitly updated
  alongside any backend capability change (none is in scope for this
  mission).
- Fixture requires no configuration. Docker (local/remote, with optional
  TLS) and OpenShift (via a pasted `oc login` command, never executed,
  System/Direct/Custom proxy modes honoring `HTTPS_PROXY`/`HTTP_PROXY`/
  `NO_PROXY`) retain their exact current configuration semantics.
- OpenShift Loki retains its current, narrower capability set relative
  to OpenShift Direct (no Live, no Context/surrounding-logs, Raw LogQL
  only when explicitly enabled by configuration) — a redesign must not
  visually imply parity it doesn't have.

## 2. Search semantics

- **Time range**: presets (15m/30m/1h/4h/1d/7d) plus Custom
  (Start/End, Apply/Cancel, always shows the actual resolved interval
  and timezone, never a generic "Custom range" label); zero-results
  offers a one-click "Search last 1 day" shortcut.
- **Newest/Oldest**: a single authoritative sort state shared between
  the dedicated toggle and the Time column header — never two competing
  sort controls.
- **Quick filters**: Service, Severity (All/Errors only, plus a
  Trace/Debug visibility toggle, hidden by default), free-text search
  (with ID-shape detection suggesting a specific field).
- **Advanced filters** (all of the following fields must remain
  reachable, grouped, with their current exact/contains match semantics
  preserved): User name, Customer ID, CIF, Device ID, Device IP
  (all masking-subject), Trace ID, Span ID, Correlation ID, Journey ID,
  Event ID, Error code, Business step, UI identifier, Logger/class
  contains, Message contains, Device platform, Language.
- **Advanced query / Raw LogQL**: remains available exactly where the
  backend currently allows it (Loki, config-gated, off by default) —
  never expanded to sources that don't support it, never removed where
  it's already available.

## 3. Results table

- Exactly the current set of result data must remain representable:
  Time (date+time+milliseconds), Level, Service, message
  ("What happened"), User/Customer (masked by policy),
  Correlation/Trace, and row Actions — a redesign may reorganize
  *presentation* but not drop any of these as retrievable/visible data.
- Real per-column sort, compatible with the single Newest/Oldest sort
  state (CLAUDE.md §4's "one authoritative sort state" rule).
- Column visibility, reorder (drag-and-drop, with a keyboard
  Move-up/down fallback), density (Comfortable/Compact), and a
  one-click Reset to default — all currently real, must stay real.
- Missing values always render an explicit placeholder (`—`), never an
  empty cell.
- Selected-row state persists across column/density/sort changes and
  across pagination (Load More).
- Truncated results are always disclosed honestly (shown count vs. true
  total) — never silently capped without saying so.
- No unbounded scans, arrays, buffers, or DOM rows (CLAUDE.md §4
  "Bounds" — Live's 1,000-event display cap with dropped/buffered counts
  shown is the existing pattern to preserve).

## 4. Event Inspector

- Exactly five primary groupings, always present regardless of data
  availability, honest empty states instead of hidden tabs: Overview,
  Actor & client, Request flow, Business & error, Technical / all
  fields (or a clearly equivalent grouping — see §19 of the mission: "you
  may improve the presentation/navigation, you may NOT hide data").
- Every field an event carries — including fields Log Explorer doesn't
  specifically recognize — remains reachable, in full, somewhere in the
  Inspector (the current "Technical / all fields" tab's filterable field
  list + Raw JSON disclosure is the concrete existing mechanism; a
  redesign may present this differently but the underlying guarantee,
  "no field is ever discarded from view," must hold).
- Previous/Next navigation between loaded results without closing the
  Inspector remains available, keyboard-reachable (`[`/`]` today).
- No fabricated causality anywhere in Inspector copy or layout.

## 5. Show surrounding logs (Context)

- The ±30-second, same-execution-context window semantics
  (`ContextAction.tsx`'s `WINDOW_MS = 30_000`) are preserved exactly —
  a redesign must not silently change the window size or widen scope to
  a different pod/service.
- The root/selected event remains unmistakably, visually dominant (§20
  of the mission: "The root event must visually dominate enough to be
  unmistakable"), auto-scrolled into view.
- True chronological order, independent of the main search's
  Newest/Oldest setting.
- Partial-window disclosure (when the event is near the stream's start
  or end) remains honest, never silently filled in.
- Remains a **distinct concept and distinct control** from
  Correlation/Trace/Journey — never merged (see Design Principle 8).

## 6. Correlation, Trace, Journey

- "Find this Trace/Correlation/Journey/Event ID" actions remain
  available from the Request Flow grouping wherever an event actually
  carries that identifier, across all four sources identically (this
  mechanism does not vary by source — only by whether the event data
  itself has the field).
- Results are shown in true chronological order; no causal claim is
  ever implied.

## 7. Live logs

- Start/Pause/Resume/Stop/Clear, exactly as today: Pause retains
  buffering (nothing lost, "Buffered while paused: N"), Stop closes the
  connection for real (not just visually), Start after Stop begins a
  genuinely fresh session.
- Received vs. Visible counts remain distinct and both shown.
- Multi-replica OpenShift partial connectivity is disclosed honestly
  (e.g. "LIVE (2/4 active)"), never overstated as a plain "LIVE."
- Automatic reconnection where possible; an honest status message where
  not.
- The "← Back to search results" action remains a real, keyboard
  reachable control returning to Search with filters intact.
- Live remains shown only for sources that declare support for it (not
  OpenShift Loki today — see `CAPABILITY_MATRIX.md`).

## 8. Masking / Privacy

- Exactly five protected fields: CIF, Username, Customer ID, Device ID,
  Device IP.
- Masked by default; masking is global and source-independent (applies
  identically across Fixture/Docker/OpenShift/Loki).
- Enforcement is server-side; no client-side reconstruction of an
  already-masked value; no per-row "reveal" action anywhere in the
  product (CLAUDE.md §2 rule 5, a hard security invariant, not a design
  choice).
- Disabling a field's masking is an explicit, global, reversible
  per-field toggle whose effect is disclosed honestly (applies to future
  requests only, never retroactively reveals already-rendered masked
  values).

## 9. Settings information architecture

- Privacy & Masking remains a **global** setting, visually and
  structurally separate from Docker-specific and OpenShift-specific
  settings (this was itself a prior, owner-confirmed correction — see
  Owner Requirements Register PCFR-2 — a redesign must not regress it
  back into a single combined settings surface).
- Docker settings (Local/Remote, host, port, TLS + certificate path,
  Test Connection) and OpenShift settings (`oc login` paste, proxy mode
  System/Direct/Custom with Custom host/port, connection status) remain
  distinct, source-specific surfaces with their current fields and
  validation behavior.

## 10. Proxy and TLS

- OpenShift/Loki proxy modes (System honoring environment variables,
  Direct bypassing any proxy, Custom with explicit host/port) remain
  available, sharing one authoritative configuration between OpenShift
  API and Loki (Owner Requirements Register PCFR2-3) — never allowed to
  drift independently.
- TLS verification for OpenShift/Loki always stays on; there is no UI
  path to disable it. Remote Docker's TLS remains an optional connection
  mode (not verification-bypass) with certificate-path configuration.
- No token, credential, or certificate content is ever rendered in a
  way that could leak it (no debug/console echo, no URL embedding).

## 11. Desktop behavior

- Windows and macOS desktop packaging/launch behavior is unaffected by
  this redesign; the current unsigned/unnotarized-build warnings and
  their documented workarounds (`docs/user-guide/TROUBLESHOOTING_EN.md`)
  remain accurate.

## 12. Responsiveness and accessibility contracts

- WCAG 2.2 AA target (CLAUDE.md §7) is preserved and, where the
  redesign proposes changes, re-verified: semantic HTML, labeled
  controls, full keyboard workflows, visible focus, screen-reader
  labels, sufficient contrast, non-color-only meaning, logical focus
  restoration, reduced-motion support, live-region announcements where
  currently present, zoom and reflow correctness at 125%/200%.
- Optimized for 1920/1440/1280 viewport widths; remains usable down to
  1024/768.
- Table geometry invariants (CLAUDE.md §4: fixed `table-layout`, header/
  cell alignment within 2px, one `<table>`/`<colgroup>`, horizontal
  overflow contained to the table, never the page) are preserved under
  any new visual treatment.

---

## Verification obligation

Any later implementation phase that builds on a chosen direction must
re-run the same functional regression this baseline already passed
(backend 1078/1078, frontend 871/871, E2E 307/307, per
`docs/verification/FINAL_PRE_UX_BASELINE_REPORT.md`) before it can be
considered complete — a visually successful redesign that fails this
regression has not succeeded. This mission (design discovery only) does
not itself run that regression against new implementation, because no
production implementation happens in this mission (see §23 of the
mission brief) — it runs the regression only against the actual,
unchanged production code, to prove the prototypes/scaffolding
introduced no behavior change (`PRODUCTION_BEHAVIOR_CHANGED=NO`).
