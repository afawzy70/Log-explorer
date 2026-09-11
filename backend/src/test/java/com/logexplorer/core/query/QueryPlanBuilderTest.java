package com.logexplorer.core.query;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.query.ast.And;
import com.logexplorer.core.query.ast.Comparison;
import com.logexplorer.core.query.ast.Operator;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Unit coverage for {@link QueryPlanBuilder} (Legacy Remediation Slice 2) —
 * the resolved-query rendering, honest push-down passthrough, the always-
 * complete post-filter list, and the redaction boundary. HTTP-level
 * behavior (through the real controller) and the leak-proof guarantee live
 * in {@code api.QueryPlanApiIntegrationTest}/{@code api.QueryPlanLeakTest}.
 */
class QueryPlanBuilderTest {

  private static final Instant START = Instant.parse("2026-01-01T00:00:00Z");
  private static final Instant END = Instant.parse("2026-01-01T01:00:00Z");

  private SearchRequest.Builder baseRequest() {
    return SearchRequest.builder().sourceId("s").start(START).end(END);
  }

  @Test
  void noQueryNoFiltersProducesAnEmptyHonestPlan() {
    QueryPlan plan = QueryPlanBuilder.build(baseRequest().build(), List.of());
    assertThat(plan.resolvedQuery()).isEqualTo("(no query)");
    assertThat(plan.rawLogQlMode()).isFalse();
    assertThat(plan.pushedDownConditions()).isEmpty();
    assertThat(plan.postFilterConditions()).isEmpty();
    assertThat(plan.notes()).anySatisfy(n -> assertThat(n).contains("no source-side push-down"));
    assertThat(plan.notes()).anySatisfy(n -> assertThat(n).contains("No structured filters"));
  }

  @Test
  void resolvedQueryRendersTheDslWithLiteralsRedacted() {
    SearchRequest request = baseRequest()
        .query(new And(new Comparison("service", Operator.EQ, "gateway"), new Comparison("level", Operator.EQ, "ERROR")))
        .build();
    QueryPlan plan = QueryPlanBuilder.build(request, List.of());
    assertThat(plan.resolvedQuery()).isEqualTo("(service = *** AND level = ***)");
    assertThat(plan.resolvedQuery()).doesNotContain("gateway").doesNotContain("ERROR");
  }

  @Test
  void postFilterConditionsIncludeTheDslExpressionAsTheFinalEntry() {
    SearchRequest request = baseRequest().query(new Comparison("service", Operator.EQ, "gateway")).build();
    QueryPlan plan = QueryPlanBuilder.build(request, List.of());
    assertThat(plan.postFilterConditions()).contains("service = ***");
  }

  @Test
  void postFilterConditionsIncludeActiveStructuredFiltersByFieldNameOnly() {
    SearchRequest request = baseRequest()
        .services(List.of("gateway", "auth"))
        .levels(List.of("ERROR"))
        .traceId("trace-123")
        .build();
    QueryPlan plan = QueryPlanBuilder.build(request, List.of());
    assertThat(plan.postFilterConditions()).contains("service in [gateway, auth]", "level in [ERROR]", "traceId = trace-123");
  }

  @Test
  void sensitiveStructuredFiltersAndFreeTextAreRedactedInPostFilterConditions() {
    String sentinel = "SENSITIVE-PLAN-SENTINEL-71cd";
    SearchRequest request = baseRequest()
        .text(sentinel)
        .sensitiveFilters(sentinel, sentinel, sentinel, sentinel, sentinel)
        .build();
    QueryPlan plan = QueryPlanBuilder.build(request, List.of());
    String rendered = String.join("|", plan.postFilterConditions());
    assertThat(rendered).doesNotContain(sentinel);
    assertThat(plan.postFilterConditions()).contains(
        "message contains ***", "cif = ***", "userName = ***", "customerId = ***", "deviceId = ***", "deviceIp = ***");
  }

  @Test
  void pushedDownConditionsArePassedThroughVerbatimFromTheSource() {
    List<String> reportedByLoki = List.of("namespace = \"prod\" (Loki stream label, from source configuration)");
    QueryPlan plan = QueryPlanBuilder.build(baseRequest().build(), reportedByLoki);
    assertThat(plan.pushedDownConditions()).isEqualTo(reportedByLoki);
    assertThat(plan.notes()).anySatisfy(n -> assertThat(n).contains("independently re-checked"));
  }

  @Test
  void rawLogQlModeNeverEchoesTheRawLogQlTextAndStillListsPostFilterConditions() {
    String sentinel = "RAW-LOGQL-PLAN-SENTINEL-8f2a";
    SearchRequest request = baseRequest().rawLogQl("{namespace=\"" + sentinel + "\"}").levels(List.of("ERROR")).build();
    QueryPlan plan = QueryPlanBuilder.build(request, List.of("Raw LogQL executed verbatim against Loki (bypasses the generated selector entirely)"));
    assertThat(plan.rawLogQlMode()).isTrue();
    assertThat(plan.resolvedQuery()).doesNotContain(sentinel);
    assertThat(plan.postFilterConditions()).contains("level in [ERROR]");
  }

  /** OS-1C — {@code source.describeScopeWarnings} feeds this overload, appended verbatim after the generic notes. */
  @Test
  void sourceWarningsAreAppendedToNotesVerbatimAfterTheGenericOnes() {
    List<String> warnings = List.of("Only 3 of 5 resolved pod/container targets were queried (TARGET_CAP_REACHED) - some pods were skipped.");
    QueryPlan plan = QueryPlanBuilder.build(baseRequest().build(), List.of(), warnings);
    assertThat(plan.notes()).containsSubsequence(
        "This source reports no source-side push-down for this search — every condition below is evaluated after retrieval.",
        "No structured filters or query conditions are active — every event in the time range is returned.",
        warnings.get(0));
  }

  /** The two-arg overload (every other source) still defaults to no extra warnings. */
  @Test
  void theTwoArgOverloadAddsNoSourceWarnings() {
    QueryPlan plan = QueryPlanBuilder.build(baseRequest().build(), List.of());
    assertThat(plan.notes()).noneMatch(n -> n.contains("TARGET_CAP_REACHED"));
  }
}
