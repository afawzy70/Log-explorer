package com.logexplorer.core.mapping.scan;

import java.util.Set;

/**
 * One row of the "Discovered Source Schema" union (owner mission §A4/§A7)
 * — never called "Original JSON" (mission §A5: that term is reserved for
 * actual raw source events, see {@link OriginalEventSample}).
 *
 * <p>{@code path} is a real, directly-usable {@code core.mapping.JsonPath}
 * string (dot-separated / {@code ["literal.key"]} bracket syntax) — the
 * exact format {@code JsonPath.parse} accepts, so a discovered path can be
 * fed straight into a mapping candidate without any reformatting.
 *
 * <p>{@code coveragePercentage} is deliberately relative to the total
 * number of events <i>inspected</i> in the scan (mission §A11: "Observed /
 * Discovered," never "Complete / Guaranteed") — not just the subset that
 * happened to parse cleanly — so a source with many malformed events
 * honestly shows a lower percentage rather than an inflated one computed
 * only over the parseable subset.
 */
public record DiscoveredPathEntry(
    String path,
    Set<ObservedType> observedTypes,
    int occurrenceCount,
    double coveragePercentage
) {

  public DiscoveredPathEntry {
    observedTypes = observedTypes == null ? Set.of() : Set.copyOf(observedTypes);
  }
}
