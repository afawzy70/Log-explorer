package com.logexplorer.core.mapping.scan;

/**
 * Owner mission "Project-Scoped Schema Scan" §5 — every scanned event is
 * classified into exactly one of these two buckets. Only {@link
 * #STRUCTURED_JSON_APPLICATION_EVENT} events ever contribute to the
 * Discovered Source Schema union or become a representative mapping
 * sample; {@link #NON_JSON_OR_MALFORMED_EVENT} events (nginx/Loki-style
 * access/error lines, any line that isn't valid JSON) may still be shown
 * for diagnostics, but never pollute schema discovery and never become
 * "the" representative sample for mapping.
 */
public enum EventClassification {
  STRUCTURED_JSON_APPLICATION_EVENT,
  NON_JSON_OR_MALFORMED_EVENT
}
