---
version: 1
slug: "rn-developer-console-prototype-index-html-522d26e9"
primary_target: "docs/ux-v2-modern-developer-console/prototype/index.html"
related_targets: []
---

# Surface brief — Modern Developer Console prototype package

Scope: isolated design prototype of the whole Log Explorer workstation (Search, Results, Inspector, Investigation, Context, Field Mapping, Settings, Live, global states). Visitor mode: **Operate**. Not production code.

Audience: developers, support engineers and incident investigators in long, time-pressured sessions on office laptops and external monitors, often screen-sharing into incident calls. Job: find the event, understand it, follow related events, return and refine. Constraints: owner brief pins Direction B "Modern Developer Console"; latest main (6e71af8, after PR #59 Event Classification and PR #60 classification search-scope recovery, assisted extraction, visible Tags column and semantic tag colours; earlier passes 51f06e5 and 3f6b1b4) is the functional baseline; FUNCTIONAL_BEHAVIOR_LOSS_ALLOWED=NO; no fabricated capability or causality; light theme required (CLAUDE.md §7).

Unresolved decisions (owner): which of the three B visual treatments ships; whether the dark companion theme ships in the first implementation wave.

## Direction contract

THESIS: A calibrated investigation instrument, not a dashboard. Every event is a sample on one shared time axis; the selected event is the trigger; Search, Inspector and Investigation read as one instrument's sample list, probe and capture views. Refuses the dark card-grid observability dashboard and the airy white SaaS data grid.

OWN-WORLD: Graphite ink on calibrated neutral panels; one signal accent reserved for trigger, selection and focus; severity as small calibrated marks always paired with the word; hairline rulers and tick scales as the only ornament; Inter for operation, JetBrains Mono for samples and identifiers; 2–4px radii; borders before shadows.

STORY: The investigator states scope (source, project, window, services, severities), scans a dense sample list, sets a trigger on one event, probes it through five fixed tabs, opens a capture — trace, journey or ±30s context — anchored on that trigger, and returns without losing place.

FIRST VIEWPORT: 1440×900. 44px shell with product, environment and workspace trail; one 44px query bar whose Source · Project fields are the scope readout and where Search is the only filled control; a 32px scope-summary strip; the sample list filling remaining height with sticky header and Time column; Inspector docked right at 500px, joined to the selected row by the trigger ring around its severity mark.

FORM: Logic-analyzer / oscilloscope instrument grammar translated into the pinned Modern Developer Console; position 5 of 7 on the grounded list; seed key b85cc42b.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Signature interaction: the trigger. Selecting a row plants a trigger mark that carries into the Inspector header and becomes the anchor line of any capture (trace, journey, context). Live speaks acquisition-state vocabulary.
