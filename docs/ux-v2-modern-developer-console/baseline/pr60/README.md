# Classification BEFORE, after PR #60 (`main` `6e71af8`)

Real rendered screenshots of the current production app, captured for the
post-PR #60 design sync. They are the BEFORE reference for everything
`DESIGN_SYSTEM.md` §22 and `IMPLEMENTATION_PLAN.md` §2.2 propose; nothing
here is a mockup, and nothing here has been retouched.

- **Commit:** `main` `6e71af8d901418d65de2bebb472240db27779147` (PR #60 merged
  on top of PR #59).
- **Captured:** 2026-09-16, per `manifest.json` (`capturedAt`
  `2026-09-16T10:04:18.763Z`).
- **Backend:** the real backend, `SPRING_PROFILES_ACTIVE=dev`, with the real
  Vite dev server. No route mocking in any of these 21 captures — every
  state was reached by driving the app.
- **Source:** the deterministic **Fixture** source (states 20 and 21 were
  taken with Local Docker Compose selected, which is why their query bar
  shows a Compose project field). Fixture data is synthetic
  (`fixture.userNN`, `API_LOGS:` / `API_LOGS_SUMMARY:` families); **no real
  customer logs, identifiers or credentials appear in any capture**.
- **Viewport:** 1440 × 900, `deviceScaleFactor: 1`.
- **Rules:** created through the real UI and the real API for the capture.
  Rule storage is a temporary data directory, whose full path is visible in
  the meta line of state 20 (see C-9 / C-20 in
  `../../CURRENT_BASELINE_INVENTORY.md`).

Machine-readable index: [`manifest.json`](manifest.json) — one entry per
file, each with the `note` the capture was taken for. The narrative index
below adds why each one constrains the design.

Sibling baselines: [`../README.md`](../README.md) (the whole-app BEFORE at
`3f6b1b4`, and the PR #59 classification set at `51f06e5`).

## Index

### Source policy

| File | What it shows | Why it matters |
|---|---|---|
| `01-source-selector-loki-unavailable.png` | Startup with **Local Docker Compose** selected by policy, health still `Checking…`, empty canvas. The selector is a **closed** native `<select>`. | Honest limitation: the manifest note for this file describes the option order (Docker → OpenShift → OpenShift Loki — Not available), but a native option list cannot be screenshotted open in headless Chromium, so this image does **not** show it. The option truth lives in `../classification/source-select-options.json` and `../classification/c00b-*.png`. What this capture does confirm is that PR #60 changed nothing about source policy: the design must still keep a native `<select>` with a native disabled option (D26, SSEL-1…3). |

### Rule creation (the six-step builder)

| File | What it shows | Why it matters |
|---|---|---|
| `02-search-before-any-rule.png` | Search narrowed by free text to `API_LOGS`, before any rule exists: the **Tags** column is already present and every row renders `—`. | The Tags column is part of the *default* column set now, not an opt-in — it is visible even when nothing is classified. This is the BEFORE for §22.3 and the amended eight-column contract. |
| `03-inspector-unclassified-actions.png` | An unclassified event in the Inspector: the action row offers only **Create tag rule from this event**. | The two authoring entry points are already gated by classification state. §22.8's structural split must preserve that gate, not re-derive it. |
| `04-rule-builder-source-step.png` | Step 1 Source: the anchor field (`message`) and the selected event's read-only value. | The anchor strip in §21.6 / §22.6 is drawn from this; the anchor is also what CSX-3 guarantees will take part in detection. |
| `05-rule-builder-detect-initial.png` | Step 2 Detect before running, including the hint describing what will be sampled. | The BEFORE for D33: the hint reads "…from the current search scope (source, project, services, severity and time range)", which predates PR #60 and understates what is actually sampled. |
| `06-rule-builder-detected-current-scope.png` | Detect run against the **current search** population: `Sampled: 30 · With this field: 30 · Similar: 24`, stable structure, variable parts, suggested pattern, "Matches 24 of 24 similar events; also matches 0 other sampled events", suggested extractions. | The behavioural proof of CSX-1: 30 sampled is the narrowed `API_LOGS` result set, not the newest 200 of the whole source. It is also the evidence that the hint copy above is wrong while the behaviour is right. |
| `07-rule-builder-classification-colour.png` | Step 3 Classification: rule name, tags, and the **Tag colour** fieldset — eight radio swatches (Grey, Blue, Cyan, Green, Amber, Orange, Red, Purple) each drawn as a chip carrying its own colour name, plus a live `Preview:` chip. | The BEFORE for §22.4 and D32. Note the production chip grammar: tinted background + **coloured text**, no dot. The design's tinted pill + dot + neutral text is a deliberate change, not a correction of a defect. |
| `08-rule-builder-extraction-confirmed.png` | Step 4 Extraction with values already adopted from the detector, each as a `(confirmed)` fieldset, above the suggestion panel. | Suggested and Confirmed are two distinct things on one page. §22.7's three states must not collapse them. |
| `09-extraction-suggestions.png` | Assisted extraction in full: "Read from 24 matching events in the current search, out of 30 sampled. Counts describe this bounded sample only." and one suggestion row — checkbox · name · `Found in 24 / 24` · Output name · *Never show this value* · Remove — with **Add 1 selected value**, **Detect extractable values again**, and "Already extracted by this rule: api, url, requestPath, duration." | The BEFORE for §22.7 and D35. Coverage is measured text today, not a bar; the row carries no value-type control and no preview. The design adds both — an addition to record, not an existing element to restyle. |
| `10-rule-builder-test-results.png` | Step 5 Test against the same current-search sample: matched / not matched, extraction coverage, matched and borderline examples, and the server's review note. | Test reads the same scope as Detect, so the scope component in §22.6 must be one component used twice, not two that can drift. |
| `11-rule-builder-save-review.png` | Step 6 Save: the review summary before an explicit save. | Save is the only write. Detect and Test never write — a constraint every recomposition must keep. |
| `12-rule-saved-notice.png` | The saved notice, telling the user that already-loaded results are not silently reclassified. | Truthful copy that the design must keep: rules apply to future reads only. |

### Search with classification

| File | What it shows | Why it matters |
|---|---|---|
| `13-search-tags-visible-coloured.png` | The core PR #60 outcome: the Tags column populated, matching rows carrying the tag in the rule's colour, with no Inspector open. | CSX-8 in a picture. Classification is discoverable from the table alone. |
| `14-search-multiple-tags-first-plus-count.png` | Two rules match: `middleware` plus a `+1` counter, the full list in the cell's accessible name and tooltip; unclassified rows still `—`. | The BEFORE for §22.3. Production draws the `+1` counter in the **same colour as the first tag**; the design makes it neutral. That difference is a design decision (D30), recorded in `../../CURRENT_BASELINE_INVENTORY.md` §14 as C-16. |
| `15-tag-filter-panel.png` | The **Classification tags** group inside More filters, applied server-side after classification, with ANY semantics. | Unchanged by PR #60. Note the asymmetry the design must state exactly once: this filter exists for searching, and is deliberately never carried into an authoring sample (CSX-2). |

### Inspector

| File | What it shows | Why it matters |
|---|---|---|
| `16-inspector-classified-actions.png` | A classified event: **Add extraction from this event** *and* **Create another tag rule** side by side in the action row. | Two intentions, two controls. D34 keeps them distinct structurally; they must never collapse into one menu. |
| `17-inspector-classification-blocks.png` | The Classification section inside Overview: the event's tags as uppercase chips in the table's colours, then one block per matching rule (rule name + its lowercase tag chips + extracted values, or "This rule extracts no fields."). | Colour parity between table and Inspector already holds, and the design must keep it. The uppercase/lowercase split between the two chip rows is still there (C-7, now C-19). |

### Extend a rule

| File | What it shows | Why it matters |
|---|---|---|
| `18-add-extraction-rule-chooser.png` | Two rules classified the event, so the user is asked "Which rule should this value be added to?" — each row is rule name + its coloured tags + **Add extraction to \<rule name\>**, with Cancel. | Never an ambiguous default. The BEFORE for §22.8's chooser — note that production shows no matcher summary and no extract count on these rows; the design adds them. |
| `19-add-extraction-editor.png` | The chosen rule opened on its extraction step, with the event as the anchor for suggestions. | Production reuses the full six-step editor in `edit` mode, opened at step 4. The separate three-step **Values · Test · Save** frame in §22.8 / D37 is a design proposal, not existing behaviour. |

### Rule management

| File | What it shows | Why it matters |
|---|---|---|
| `20-rules-list-with-colours.png` | Settings-bound rules list (still reached from the shell today): revision and full storage path, runtime counts, New rule / Import… / Export all / Export selected, filter, and a table of select · Name · **Tags as coloured chips** · Matches on · Enabled switch · Edit / Duplicate / Test / Delete. | Tags in the list are coloured chips now, not comma text — this supersedes part of C-7. Also still visible: the full server path in the meta line (C-9) and `message · STARTS_WITH` enum text (C-8). |

### Import

| File | What it shows | Why it matters |
|---|---|---|
| `21-import-preview-tag-colour-conflict.png` | The import preview for a pack whose rule gives the existing `middleware` tag a different colour. The preview reports `Rules in pack: 1 · New: 1 · Identical: 0 · Conflicts: 0 · Invalid: 0`, one New item, the Merge / Replace all choice, and an enabled **Apply import**. | **Read this capture carefully.** The tag-colour conflict is *not* reported in the preview. The backend computes it (`ClassificationRuleService.ImportPreview.tagColorConflicts`, `TagColorPolicy`) and refuses the write, but the frontend `ImportPanel.tsx` never reads that field, so the conflict only surfaces as a validation error at Apply time. The file name is kept from the manifest, but the state it shows is the **gap**, not the feature. Recorded as C-23 in `../../CURRENT_BASELINE_INVENTORY.md` §14. |

## Limitations of this set

- **Fixture only.** Every capture is the deterministic Fixture source (or an
  empty Local Docker Compose for 20 and 21). No Docker or OpenShift log data
  was read. The sample collector is source-neutral by construction, but that
  is a code property, not something these screenshots verify.
- **One viewport.** 1440 × 900 only. Narrow-width behaviour for the PR #60
  surfaces (suggestion rows, chooser rows, the colour picker) is **not**
  covered here; the PR #59 set has 390 px captures for the older surfaces
  (`../classification/c28`–`c30`).
- **Light theme only**, matching what the product ships.
- **No measurements file.** Unlike `../measurements.json`, no geometry was
  recorded for this set, so any claim about the Tags column's rendered width
  or row-height parity must be re-measured, not read off these images.
