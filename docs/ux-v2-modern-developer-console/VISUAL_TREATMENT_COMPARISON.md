# Visual Treatment Comparison: B1, B2 and B3

This compares three visual treatments inside the owner-approved Direction B, Modern Developer Console. It does not
reopen the A/B/C direction decision.

All three treatments share:
- the same components, density, typography, grammar (trigger, capture, lanes, gap bands), motion and behaviour;
- one semantic token vocabulary.

They differ only in the token values in `prototype/styles/tokens.css`, plus the radius scale for B3.

**The recommendation below is a proposal. It is not approved.** The owner chooses the treatment (decision D0 in
`IMPLEMENTATION_PLAN.md`).

## The treatments

| | **B1 Instrument Neutral** | **B2 Night Bench** | **B3 Enterprise Workbench** |
|---|---|---|---|
| Character | Graphite ink on cool neutral panels; one teal signal accent | Dark bench, low-glare surfaces, bright teal signal | Warm stone work surfaces under a dark graphite shell; indigo accent |
| Theme | Light primary, with a **B1 dark companion** defined as its own token set | Dark-first (dark only as drawn) | Light work area with a dark shell |
| Accent | `#0b6975` (dark companion `#4fb3bd`) | `#5cc7b8` | `#3949a8` |
| Radii | 2 / 3 / 4 / 6 px | 2 / 3 / 4 / 6 px | 2 / 4 / 6 / 8 px |
| Evidence | `screenshots/b1/*` (all 40 states), `b1-dark/*`, `responsive/*` | `screenshots/b2/{01,04,09,11,13,18}` | `screenshots/b3/{01,04,09,11,13,18}` |

## Measured facts (identical across treatments unless noted)

These come from Playwright against the prototype at 1440×900 (`capture-report.json`, `scratchpad` verification):

- Fully visible result rows: 26 in all three treatments. The `main` baseline shows 13.
- No page-level horizontal overflow at 1920, 1440, 1366, 1024, 768 or 390 px.
- Results table header/cell geometry difference: 0 px.
- Text contrast (`DESIGN_SYSTEM.md` §2.5): every body, meta and severity-word pair is ≥ 4.5:1, and every severity mark
  and control border is ≥ 3:1, in B1, B1 dark, B2 and B3.

## Scored comparison

Scores run 1 (weak) to 5 (strong). The measurable items above are equal across treatments, so these scores are
designer judgement grounded in the named screenshots. They are not user-research results.

| Criterion | B1 | B2 | B3 | Evidence and reasoning |
|---|---|---|---|---|
| Long-session readability | 4 | 4 | 4 | B1 is calm neutral light for office lighting, and its dark companion covers night incident work. B2 has low glare at night, but light-on-dark text blooms in bright rooms and washes out on shared projectors and screen-share compression. B3 is comparable to B1; its warm ground is slightly softer. |
| Scanning (rows, IDs, time) | 5 | 4 | 4 | `b1/01`: separators, the ERROR wash and marks read cleanly. `b2/01`: the ERROR wash (`#1f1415`) is barely distinct from the surface, so severity relies more on marks. `b3/01`: warm stone lowers separator contrast a little. |
| Hierarchy (chrome vs work) | 4 | 4 | 5 | `b3/01`, `b3/04`: the dark shell separates navigation from work most clearly. B1 and B2 separate chrome by surface steps and hairlines only. |
| Technical feel | 4 | 5 | 3 | B2 reads most like a developer tool. B3's warm stone and indigo read closer to a business application. |
| Originality within B | 3 | 4 | 3 | The signature (trigger ring, capture plot, gap bands) is shared, so palette adds only modest distinction. B2 is the most atmospheric. |
| Enterprise fit | 5 | 3 | 5 | B1 and B3 fit corporate laptops and screen-sharing into incident calls. As a sole theme, B2 conflicts with CLAUDE.md §7 ("light theme required"). |
| Severity clarity | 5 | 4 | 4 | B1: the teal accent is distinct from INFO blue, WARN amber and ERROR red. B3: indigo accent (`#3949a8`) and INFO blue (`#2f5c8f`) are neighbours, so a selected INFO row is slightly less distinct. B2: the teal accent sits close to the success green used for LIVE. |
| Inspector readability | 5 | 4 | 5 | `b1/04`, `b3/04`: the key/value lists and code blocks read cleanly. `b2/04`: long mono values on dark need more focus. |
| Investigation readability | 5 | 4 | 4 | `b1/09`, `b1/11`: lanes, gap hatching and the selected-event line are crisp. `b2/09`: gap hatching is faint on dark. `b3/09`: warm lanes are good, but the indigo trigger line is nearer the INFO marks. |
| Density | 5 | 5 | 5 | Identical metrics. |
| Accessibility | 5 | 3 | 4 | All treatments pass the contrast floor. B1 also meets CLAUDE.md §7 with a defined dark option. B2 needs a light counterpart to be allowed, which means building B1 anyway. B3 needs two focus and hover contexts (dark shell, light work), which adds review surface. |
| Maintainability | 5 | 3 | 3 | B1 is one vocabulary with two neutral value sets. B2 needs a second (light) set to ship at all. B3 needs extra shell tokens (`--shell-*`), a radius override and dual-context states. |
| **Total (of 60)** | **55** | **47** | **49** | |

## Recommendation (not auto-approved)

**Recommend B1 Instrument Neutral as the primary treatment, with the B1 dark companion as a later option** (dark/light
decision C, `DESIGN_SYSTEM.md` §19).

Why B1:
- It is the only treatment that satisfies the light-theme requirement, gives the clearest severity and selection
  separation, and keeps one maintainable token vocabulary, all at once.
- It keeps what B2 does well: the B1 dark companion is derived from B2's night-bench values, so dark-room incident work
  is still served once dark passes its own gates.
- It keeps what B3 does well, if the owner wants stronger chrome separation. B3's dark-shell idea can be adopted into
  B1 later as a shell-only token change, without a new treatment.

What the owner gives up by choosing B1:
- Some of B2's atmosphere and technical mood.
- B3's stronger shell/work separation.

Neither affects workflow or behaviour.

If the owner prefers B2 or B3, every component, state and the implementation plan stay the same; only the token value
set and the D9 dark-theme timing change.
