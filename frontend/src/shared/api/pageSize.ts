/**
 * PR65_FRESH_SEARCH_CUSTOM_TIME_AND_BATCH_RECOVERY (defect 3) — the bounded
 * page size this UI asks for on every Search and every "Load more", sent
 * explicitly as `SearchRequestBody.limit` rather than left implicit.
 *
 * Sending it explicitly (instead of relying solely on the backend's own
 * `logexplorer.search.default-limit`, see `backend/src/main/resources/
 * application.yml`) keeps the two in sync by construction and makes "the
 * default requested page size is 500" a directly testable request-body
 * property. The backend's own guardrails (`SearchGuardrailsProperties`)
 * still independently validate and clamp this value regardless — this
 * constant is never the only line of defense.
 *
 * Kept in one place so "Load more" always requests the same page size a
 * fresh Search did — CLAUDE.md's "one pagination model only" extends to
 * page size, not just the cursor mechanism itself.
 */
export const DEFAULT_PAGE_SIZE = 500;
