package com.logexplorer.core.query;

import java.util.List;

/**
 * Query-plan transparency (Legacy Remediation Slice 2,
 * {@code docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md} §"Slice 2 — Query
 * transparency & advanced query authoring"). A structured, honest account
 * of what a search actually did: the resolved query representation, source
 * push-down (an optimization only — see {@link QueryPlanBuilder}), and the
 * authoritative post-filter conditions {@code core.search.EventFilters}
 * always evaluates regardless of what was pushed down.
 *
 * <p>{@code resolvedQuery} is built from {@link QueryPlanExplainer} (every
 * literal value unconditionally redacted) or a fixed raw-LogQL placeholder
 * — never the raw DSL/LogQL text itself. {@code pushedDownConditions}/
 * {@code postFilterConditions} name only field/grammar vocabulary and
 * fixed, non-sensitive configuration values (namespace, service name — not
 * one of the five protected fields) — see {@code QueryPlanBuilder} for the
 * exact redaction boundary, which mirrors {@code SearchRequest#toString()}.
 */
public record QueryPlan(
    String resolvedQuery,
    boolean rawLogQlMode,
    List<String> pushedDownConditions,
    List<String> postFilterConditions,
    List<String> notes
) {
  public QueryPlan {
    pushedDownConditions = pushedDownConditions == null ? List.of() : List.copyOf(pushedDownConditions);
    postFilterConditions = postFilterConditions == null ? List.of() : List.copyOf(postFilterConditions);
    notes = notes == null ? List.of() : List.copyOf(notes);
  }
}
