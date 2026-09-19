# Stage 6 — Safe Legacy Cleanup — Verification Report

Session 11 (`MODERN_DEVELOPER_CONSOLE_SESSION_11_COMPLETE_GLOBAL_HARDENING`).

## Method

For every deletion candidate, proved (not assumed): (1) no production consumer, (2) no legitimate
compatibility role, (3) no test/behavior dependency, (4) no desktop packaging dependency, (5) no
hidden workspace still uses it — via repo-wide `grep` across every `.css`/`.tsx`/`.ts` file (both
production and test), the `desktop/` packaging directory and its build scripts, and the backend Java
source. No deletion was made on filename/prefix pattern alone.

## REMOVE_DEAD — deleted

### `shared/tokens.css`'s own v1 `--color-*` palette (~49 declarations)

Background/text/accent/severity/tag/protected/danger color tokens. Proven dead: zero remaining
`var(--color-...)` consumers anywhere in the frontend (Stage 2's dark-theme completion had already
migrated every real consumer to `--v2-*`). One genuine exception was found and **fixed, not deleted
alongside the rest**: this same file's own global `:focus-visible` fallback rule internally consumed
`--color-focus-ring` — a real, currently-active `V2_MIGRATION_GAP` (any element relying on this
fallback, rather than its own more specific rule, would have painted a light-blue-only ring with no
dark-theme adjustment). Migrated to `--v2-focus` first, verified via real-browser computed-style check
(light: `rgb(11,105,117)` = `--v2-focus` light value; dark: `rgb(108,195,203)` = `--v2-focus` dark
value — both correct), then the rest of the palette was deleted.

### `--radius-sm`/`--radius-md`/`--radius-lg`/`--border-width`/`--shadow-sm`/`--shadow-md`

Also found dead during the same audit (not part of the original "known gap" list, found by widening
the same grep to every non-color primitive in the file). One genuine exception again: `--shadow-md`
had exactly one remaining consumer, `EventInspector.module.css`'s overlay-mode panel shadow (the
1024px-breakpoint overlay verified in Stage 4). Migrated to `--v2-shadow-pop` first, then the rest
deleted.

### `ResultsPanel.module.css`'s `.summaryRow`, `.summary`, `.empty`, `.error`, `.loading`,
`.errorTitle`, `.errorDetail`

Flagged in Stage 2's own report as dead-code candidates (superseded by `.statePanel*`'s B3 restyle and
ScopeStrip's own counts `readout`). Re-confirmed zero consumers immediately before this deletion via
the same grep, and widened further: `.summaryRow` itself (a wrapping-row fix, previously assumed still
in use) and `.errorTitle`/`.errorDetail` were found to have zero consumers too while removing the
others. A full class-by-class cross-check of every remaining selector in the file against
`ResultsPanel.tsx` confirms every surviving class (`investigationBleed`, `loadMoreError`,
`loadMoreRow`, `skeleton`/`skeletonBar`/`skeletonRow`/`skeletonRows`, `staleNotice`/`staleResults`,
`statePanel` and its five sub-classes, `wrapper`) has at least one real consumer.

## KEEP_COMPATIBILITY — reviewed, not removed

**`--motion-base`** (`shared/tokens.css`): also currently unused (zero consumers, confirmed by the
same grep), but deliberately left in place. Unlike the retired v1 color palette, it is not part of a
superseded system being replaced by something else — it is one small, plausible, generically-useful
motion-timing primitive that nothing happens to reach for yet. Removing single unused primitives that
aren't tied to a retired system is a different, lower-value category of cleanup than removing an
entire dead color palette, and risked reading as speculative "tidying" rather than genuine dead-code
removal.

**`JourneyEntryRow`'s classification is unchanged**: `B7_STRUCTURAL_DEAD_CODE_REMOVAL`, confirmed
again this session (Stage 2's pre-stage safety check) — no new evidence contradicts it, not
re-litigated here.

## KEEP_STILL_USED — considered, kept

No further candidates were found. `--font-*`/`--space-*`/`--motion-fast` in `tokens.css` were checked
and confirmed heavily used (9–43 consumers each) — correctly unversioned, theme-neutral primitives
shared by the whole app, not part of the retired v1 system.

## Verification

`npm run typecheck`: PASS. Full unit suite: PASS (1163/1163). Production build: PASS — CSS bundle
measurably shrank across this session's cleanup work: 66.15 kB → 64.77 kB (tokens.css palette removal)
→ 64.05 kB (ResultsPanel dead classes removal), a real, verifiable reduction, not just a claim. Full
E2E suite, all 5 shards: 100% green (323 passed, one pre-existing unrelated skip) — run in full given
this touched the global token file and `EventInspector.module.css`.

## Conclusion

```
LEGACY_V1_CLEANUP=PASS
LEGACY_ITEMS_REMOVED=tokens.css v1 --color-* palette (~49 declarations); --radius-sm/md/lg,
  --border-width, --shadow-sm, --shadow-md; ResultsPanel.module.css's .summaryRow, .summary, .empty,
  .error, .loading, .errorTitle, .errorDetail (7 dead classes)
LEGACY_ITEMS_INTENTIONALLY_RETAINED=--motion-base (unused but not part of a retired system, low-value
  speculative removal avoided)
JOURNEY_ENTRY_ROW_CLASSIFICATION=B7_STRUCTURAL_DEAD_CODE_REMOVAL (unchanged)
```
