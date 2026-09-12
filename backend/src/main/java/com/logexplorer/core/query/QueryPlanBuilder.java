package com.logexplorer.core.query;

import com.logexplorer.core.model.RawSensitiveFields;
import com.logexplorer.core.model.SearchRequest;
import java.util.ArrayList;
import java.util.List;

/**
 * Builds a {@link QueryPlan} from one {@link SearchRequest} plus whatever a
 * {@code LogSource} genuinely reports it pushed down (Legacy Remediation
 * Slice 2). Never fabricates push-down: an empty {@code sourcePushDown}
 * list (the default every source but Loki reports — {@code
 * source.LogSource#describePushDown}) renders honestly as "no source-side
 * push-down for this search," not a guessed or omitted line.
 *
 * <p>{@code postFilterConditions} is always the <b>complete</b> set of
 * conditions {@code core.search.EventFilters} evaluates — it is never
 * narrowed by what was also pushed down, because push-down here is
 * structurally only ever an optimization ({@code
 * source.loki.plan.LogQlDslPlanner}'s own javadoc: "a missed or overly-
 * conservative pushdown opportunity can never produce a wrong result, only
 * a less-narrow fetch") — {@code EventFilters} re-applies every one of
 * these regardless. A condition can legitimately appear in both lists; that
 * is the truth, not a display bug (see the "notes" entry this class always
 * adds when anything was pushed down).
 *
 * <p><b>Redaction boundary</b> — deliberately the exact same boundary
 * {@link SearchRequest#toString()} already uses: {@code text}, the five
 * {@link RawSensitiveFields} values, and every DSL/raw-LogQL literal
 * (handled by {@link QueryPlanExplainer}, which redacts unconditionally,
 * not just for the three sensitive DSL aliases) are never echoed — every
 * other structured field (service, level, traceId, correlationId, ...) is
 * exactly CLAUDE.md §2 rule 1's own non-sensitive set and is safe to show,
 * the same judgement {@code features/search/advancedFilterFields.ts}'s
 * {@code sensitive: false} flags already make on the frontend.
 */
public final class QueryPlanBuilder {

  private QueryPlanBuilder() {
  }

  public static QueryPlan build(SearchRequest request, List<String> sourcePushDown) {
    return build(request, sourcePushDown, List.of());
  }

  /**
   * @param sourceWarnings OS-1C — a source's own truthful account of why
   *     its result might be incomplete independently of event count (see
   *     {@code LogSource#describeScopeWarnings}); appended to {@code
   *     notes} verbatim, after the generic push-down/post-filter notes.
   *     Empty for every source that doesn't have this concern.
   */
  public static QueryPlan build(SearchRequest request, List<String> sourcePushDown, List<String> sourceWarnings) {
    boolean rawLogQlMode = notBlank(request.rawLogQl());
    String resolvedQuery = rawLogQlMode
        ? "(raw LogQL query — content not displayed)"
        : QueryPlanExplainer.explain(request.query());

    List<String> pushedDown = sourcePushDown == null ? List.of() : List.copyOf(sourcePushDown);
    List<String> postFilter = buildPostFilterConditions(request, rawLogQlMode);
    List<String> notes = new ArrayList<>(buildNotes(rawLogQlMode, pushedDown, postFilter));
    if (sourceWarnings != null) {
      notes.addAll(sourceWarnings);
    }

    return new QueryPlan(resolvedQuery, rawLogQlMode, pushedDown, postFilter, notes);
  }

  private static List<String> buildPostFilterConditions(SearchRequest request, boolean rawLogQlMode) {
    List<String> conditions = new ArrayList<>();
    if (rawLogQlMode) {
      // Raw LogQL replaces the generated selector, but every structured
      // filter and any DSL query the request also carries is still
      // independently re-applied by EventFilters afterward - same as
      // every other search, never silently skipped just because raw LogQL
      // was used.
      conditions.add("raw LogQL result is still evaluated against every active structured filter below");
    }
    if (!request.services().isEmpty()) {
      conditions.add("service in " + request.services());
    }
    if (!request.levels().isEmpty()) {
      conditions.add("level in " + request.levels());
    }
    addIfSet(conditions, "message contains", request.text(), true);
    addIfSet(conditions, "traceId =", request.traceId(), false);
    addIfSet(conditions, "spanId =", request.spanId(), false);
    addIfSet(conditions, "correlationId =", request.correlationId(), false);
    addIfSet(conditions, "journeyId =", request.journeyId(), false);
    addIfSet(conditions, "eventId =", request.eventId(), false);
    addIfSet(conditions, "errorCode =", request.errorCode(), false);
    addIfSet(conditions, "businessStep =", request.businessStep(), false);
    addIfSet(conditions, "uiIdentifier =", request.uiIdentifier(), false);
    addIfSet(conditions, "logger contains", request.loggerContains(), false);
    addIfSet(conditions, "device.platform =", request.devicePlatform(), false);
    addIfSet(conditions, "language =", request.language(), false);
    addIfSet(conditions, "containerId =", request.containerId(), false);
    addIfSet(conditions, "pod =", request.pod(), false);

    RawSensitiveFields sensitive = request.sensitiveFilters();
    addIfSet(conditions, "cif =", sensitive.cif(), true);
    addIfSet(conditions, "userName =", sensitive.userName(), true);
    addIfSet(conditions, "customerId =", sensitive.customerId(), true);
    addIfSet(conditions, "deviceId =", sensitive.deviceId(), true);
    addIfSet(conditions, "deviceIp =", sensitive.deviceIp(), true);

    if (!rawLogQlMode && request.query() != null) {
      conditions.add(QueryPlanExplainer.explain(request.query()));
    }
    return conditions;
  }

  private static void addIfSet(List<String> conditions, String label, String value, boolean redact) {
    if (notBlank(value)) {
      conditions.add(label + " " + (redact ? "***" : value));
    }
  }

  private static List<String> buildNotes(boolean rawLogQlMode, List<String> pushedDown, List<String> postFilter) {
    List<String> notes = new ArrayList<>();
    if (rawLogQlMode) {
      notes.add("Raw LogQL mode: the query text is sent to the source as-is and never translated into the structured DSL.");
    }
    if (pushedDown.isEmpty()) {
      notes.add("This source reports no source-side push-down for this search — every condition below is evaluated after retrieval.");
    } else {
      notes.add("Push-down is an optimization only; every condition under \"applied after retrieval\" is independently re-checked "
          + "regardless of what was also pushed down, so pushed-down and post-filter conditions can overlap.");
    }
    if (postFilter.isEmpty() && !rawLogQlMode) {
      notes.add("No structured filters or query conditions are active — every event in the time range is returned.");
    }
    return notes;
  }

  private static boolean notBlank(String s) {
    return s != null && !s.isBlank();
  }
}
