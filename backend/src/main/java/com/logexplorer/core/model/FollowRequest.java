package com.logexplorer.core.model;

import java.util.List;

/**
 * A live-tail request (IMPLEMENTATION_PLAN.md "Phase J", HANDOVER.md §18).
 * Deliberately minimal compared to {@link SearchRequest} - live tail has
 * no time range (it only ever streams new events from "now" forward) and
 * no structured filters beyond service scoping, matching the plan's own
 * scope ("Start / Pause / Resume / Stop; follow behavior") which never
 * asks for the full search filter surface in live mode.
 *
 * <p>{@code composeProject} (UX-R3 §7/§8/§9) is the same request-scoped
 * Docker Compose project selection {@link SearchRequest} carries - never
 * sensitive (a Compose project name, not a credential), so it travels as
 * a plain SSE query parameter same as {@code sourceId}/{@code services}.
 * Sources without a real project concept (Fixture, Loki) simply ignore it.
 */
public record FollowRequest(String sourceId, List<String> services, String composeProject) {

  public FollowRequest {
    services = services == null ? List.of() : List.copyOf(services);
  }

  /** Test/legacy convenience for callers that never care about Compose scoping. */
  public FollowRequest(String sourceId, List<String> services) {
    this(sourceId, services, null);
  }
}
