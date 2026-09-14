package com.logexplorer.core.mapping.scan;

import java.time.Duration;

/**
 * Explicit, documented bounds for the Quick Schema Scan (owner mission
 * "Field Mapping Schema Scan + Masking Policy Extension" §A8 —
 * "Define explicit bounded limits... Document actual chosen limits").
 *
 * <p>The scan is deliberately allowed to <b>inspect</b> more events than it
 * <b>retains</b> as raw representative samples (§A8): every inspected event
 * contributes to the {@link DiscoveredPathEntry} occurrence/percentage
 * statistics, but only a small, bounded, deduplicated subset (one per
 * distinct severity+structure combination, up to {@link
 * #MAX_REPRESENTATIVE_EVENTS}) is ever held as an actual raw {@link
 * OriginalEventSample}.
 *
 * <p>These bounds deliberately exceed {@code
 * core.mapping.sample.FieldMappingSampleService}'s {@code DEFAULT_LIMIT=20}/
 * {@code MAX_LIMIT=50} sample-count limits — that service answers "give me
 * N recent raw samples to eyeball"; this one answers "discover the broadest
 * useful shape of this source's JSON," which structurally needs a wider
 * inspection window while still keeping raw-sample retention just as tight
 * (in fact tighter than that service's own {@code MAX_LIMIT}, since
 * discovery relies on statistics over the wider inspected set, not on
 * keeping every inspected event's raw text).
 */
public final class SchemaScanBounds {

  private SchemaScanBounds() {
  }

  /** Default number of events inspected when the caller doesn't specify one. */
  public static final int DEFAULT_MAX_EVENTS_INSPECTED = 200;

  /** Hard ceiling on events inspected in one scan, regardless of what a caller requests — never an unbounded scan. */
  public static final int MAX_EVENTS_INSPECTED_CEILING = 500;

  /** Hard ceiling on cumulative original-JSON bytes inspected in one scan (2 MB). */
  public static final long MAX_BYTES_INSPECTED = 2_000_000L;

  /** Hard wall-clock ceiling on one scan's post-fetch processing. */
  public static final Duration MAX_SCAN_DURATION = Duration.ofSeconds(5);

  /** Maximum number of actual raw original-JSON events retained as representative samples. */
  public static final int MAX_REPRESENTATIVE_EVENTS = 20;

  /**
   * Owner mission "Project-Scoped Schema Scan" §5 — maximum non-JSON/
   * malformed (infrastructure noise) lines retained for diagnostics only.
   * Deliberately much smaller than {@link #MAX_REPRESENTATIVE_EVENTS}:
   * these are never used for schema discovery or field mapping, only shown
   * so a user can see WHY a line was excluded, not to be inspected in
   * depth.
   */
  public static final int MAX_DIAGNOSTIC_NON_JSON_SAMPLES = 5;

  /** Maximum object-nesting depth the structural walker descends into for any one event. */
  public static final int MAX_WALK_DEPTH = 8;

  /** Maximum distinct JSON paths recorded for any one event (protects against pathological documents). */
  public static final int MAX_PATHS_PER_EVENT = 300;
}
