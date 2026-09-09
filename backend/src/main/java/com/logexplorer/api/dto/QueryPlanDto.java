package com.logexplorer.api.dto;

import com.logexplorer.core.query.QueryPlan;
import java.util.List;

/**
 * Outbound query-plan transparency (Legacy Remediation Slice 2). A stable
 * DTO contract, deliberately not {@link QueryPlan} itself reused directly
 * on the wire — the same "DTOs are built from already-safe values only"
 * posture {@code api.EventMapper}/{@code arch.ArchitectureTest} already
 * enforce for events. Every field here is already safe to serialize as-is
 * ({@link QueryPlan}'s own javadoc documents the redaction boundary); this
 * class performs no further transformation, only the type boundary.
 */
public record QueryPlanDto(
    String resolvedQuery,
    boolean rawLogQlMode,
    List<String> pushedDownConditions,
    List<String> postFilterConditions,
    List<String> notes
) {
  public static QueryPlanDto from(QueryPlan plan) {
    return new QueryPlanDto(
        plan.resolvedQuery(), plan.rawLogQlMode(), plan.pushedDownConditions(), plan.postFilterConditions(), plan.notes());
  }
}
