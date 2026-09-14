package com.logexplorer.core.mapping;

/**
 * Owner mission "Project-Scoped Schema Scan" — the exact logical scope one
 * field-mapping profile (and one Quick Schema Scan) belongs to: a source,
 * plus (for sources with a real sub-project concept) the specific Compose
 * project / OpenShift namespace / logical workload scope selected within
 * it. Two different projects on the same source are two different keys —
 * {@link FieldMappingProfileService} never lets one silently stand in for
 * the other (mission §7/§8: "Do not force one global mapping across
 * unrelated projects... Do not reuse a mapping from another project
 * silently").
 *
 * <p>{@code scopeId} is normalized to {@link #UNSCOPED} for {@code null}/
 * blank input — "no project selected" (Docker with no Compose project
 * chosen, or any source with no sub-project concept at all — Loki,
 * Fixture) is itself one well-defined, stable scope, distinct from any
 * named project.
 *
 * <p>{@link #UNSPECIFIED} is the scope every pre-existing, scope-agnostic
 * call site (unit tests exercising mapping/parsing mechanics independent
 * of project scoping, and {@link FieldMappingProfileService}'s own no-arg
 * convenience overloads) implicitly operates on — never used by real
 * production search/scan traffic, which always resolves a real {@code
 * sourceId} via {@link com.logexplorer.source.LogSource#resolveMappingScopeLabel}.
 */
public record MappingScopeKey(String sourceId, String scopeId) {

  private static final String UNSCOPED = "__unscoped__";

  /** The scope used when no real sourceId is known — legacy/global convenience only, never real production traffic. */
  public static final MappingScopeKey UNSPECIFIED = new MappingScopeKey("__unspecified__", UNSCOPED);

  public MappingScopeKey {
    if (sourceId == null || sourceId.isBlank()) {
      throw new IllegalArgumentException("sourceId must not be blank");
    }
    scopeId = (scopeId == null || scopeId.isBlank()) ? UNSCOPED : scopeId;
  }

  /** {@code sourceId == null}/blank falls back to {@link #UNSPECIFIED} rather than throwing — the safe default for an unspecified caller. */
  public static MappingScopeKey of(String sourceId, String scopeId) {
    if (sourceId == null || sourceId.isBlank()) {
      return UNSPECIFIED;
    }
    return new MappingScopeKey(sourceId, scopeId);
  }

  /** True when this key carries no real named project/namespace — a bare source, or {@link #UNSPECIFIED}. */
  public boolean isUnscoped() {
    return UNSCOPED.equals(scopeId);
  }

  /** A short, human-readable label for display (e.g. scan summaries) — {@code null} when {@link #isUnscoped()}. */
  public String displayScope() {
    return isUnscoped() ? null : scopeId;
  }
}
