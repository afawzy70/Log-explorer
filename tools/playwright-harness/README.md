# playwright-harness (H4a)

App-agnostic Playwright helper library, built in Phase A2a as verification-
harness component H4a. Takes a Playwright `Page` and a CSS selector — no
dependency on any particular app, because `frontend/` does not exist until
Phase B. Phase A2b relocates/imports this into `frontend/e2e/` once it does
(see `IMPLEMENTATION_PLAN.md` "Phase A2b").

## Helpers (`helpers.ts`)

- `setViewport(page, width, height?)`
- `setZoom(page, zoomPercent)` — via `document.documentElement.style.zoom`
- `assertTableGeometry(page, selector = 'table', tolerancePx = 2)` — compares
  every header cell to the corresponding cell in **every** body row (not
  just the first), throwing on any mismatch. Checking every row is what
  catches an omitted cell in a later row, which shifts every column after it.
- `assertNoHorizontalOverflow(page)`
- `captureScreenshot(page, phase, name)` — writes to
  `docs/verification/<phase>/<name>.png`, creating the directory if needed

## One documented command

```bash
npm install
npx playwright test          # or: npm test
npx playwright test --list   # resolve without running
npm run typecheck            # strict TypeScript check
```

## Fixture-validated, not just plausible

`tests/geometry.spec.ts` is a **meta-test**: it proves the assertions
actually work, both ways, against two committed static fixtures
(`fixtures/table-correct.html`, `fixtures/table-broken.html`) — no app
required:

- the correct fixture is a single semantic `<table>` with one `<colgroup>`,
  `table-layout: fixed`, shared header/body geometry — `assertTableGeometry`
  and `assertNoHorizontalOverflow` must both **pass** against it, at normal
  zoom and at 200%;
- the broken fixture deliberately reproduces three real historical
  regressions in one page: the `<thead>` is pulled into `display: flex`
  with widths that don't match the body's `<colgroup>` (header/body styled
  independently), one body row omits a cell entirely instead of rendering
  `—` (shifting every later column), and an oversized element forces
  page-level horizontal scroll. `assertTableGeometry` and
  `assertNoHorizontalOverflow` must both **throw** against it.

An assertion that has never been proven to fail correctly is not proven to
work — this is why the meta-test exists before Phase G is ever allowed to
depend on these helpers.
