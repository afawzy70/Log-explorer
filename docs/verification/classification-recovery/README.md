# Classification recovery — AFTER evidence

Captured from the real running application (real backend, `SPRING_PROFILES_ACTIVE=dev`, deterministic Fixture
source) at 1440×900 while verifying
[`CLASSIFICATION_SCOPE_EXTRACTION_VISUAL_TAGGING_REPORT.md`](../CLASSIFICATION_SCOPE_EXTRACTION_VISUAL_TAGGING_REPORT.md).
The rule used is the owner's own case: `message STARTS_WITH "API_LOGS:"`, tag `middleware`, colour **BLUE**.

| File | Shows |
|---|---|
| `AFTER-1-results-table-tagged.png` | Search narrowed to `API_LOGS`. The **Tags** column is visible by default and every matching row carries the `middleware` chip in the rule's colour — no inspector needed. The deliberately similar `API_LOGS_SUMMARY:` rows correctly show `—`, and tagged rows are no taller than untagged ones. |
| `AFTER-2-inspector-classification.png` | The same event in the Event Inspector: **Add extraction from this event** and **Create another tag rule** offered for a classified event, and the same tag identity as the table. |
| `AFTER-3-assisted-extraction.png` | "Add extraction from this event" opening the matching rule on its extraction step, with the values it already extracts and what the sample was read from. |

The earlier evidence folders in `docs/verification/` belong to their own missions and were deliberately **not**
regenerated here, so screenshots taken before this recovery still show the results table as it was then (seven
default columns, no Tags column).
