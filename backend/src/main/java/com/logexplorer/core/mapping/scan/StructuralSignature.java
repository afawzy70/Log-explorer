package com.logexplorer.core.mapping.scan;

import java.util.Collection;
import java.util.List;

/**
 * A deterministic, bounded structural signature for one event's JSON shape
 * (owner mission §A2 — "detect structural diversity via a deterministic
 * bounded structural signature based on JSON structure (two INFO logs with
 * materially different JSON paths = two useful shapes)").
 *
 * <p>Deliberately the sorted, deduplicated set of discovered path strings
 * itself, bounded to {@link SchemaScanBounds#MAX_PATHS_PER_EVENT} — not a
 * cryptographic/opaque hash. Two events produce an {@code equals()}
 * signature exactly when they expose the same set of JSON paths, which is
 * both deterministic and directly inspectable/debuggable (mission §A2 does
 * not require secrecy, only determinism and a bound).
 */
public record StructuralSignature(List<String> paths) {

  public StructuralSignature {
    paths = List.copyOf(paths);
  }

  public static StructuralSignature of(Collection<String> rawPaths) {
    List<String> sorted = rawPaths.stream()
        .distinct()
        .sorted()
        .limit(SchemaScanBounds.MAX_PATHS_PER_EVENT)
        .toList();
    return new StructuralSignature(sorted);
  }

  /** The signature for an event whose original JSON could not be parsed — every malformed event shares this one signature. */
  public static StructuralSignature malformed() {
    return new StructuralSignature(List.of("__malformed__"));
  }

  /** A stable, human-inspectable string form — used only as a dedup/display key, never persisted as a security boundary. */
  public String fingerprint() {
    return String.join("|", paths);
  }
}
