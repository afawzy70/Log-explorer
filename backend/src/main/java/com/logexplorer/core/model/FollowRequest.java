package com.logexplorer.core.model;

import java.util.List;

/**
 * A live-tail request (IMPLEMENTATION_PLAN.md "Phase J", HANDOVER.md §18).
 * Deliberately minimal compared to {@link SearchRequest} - live tail has
 * no time range (it only ever streams new events from "now" forward) and
 * no structured filters beyond service scoping, matching the plan's own
 * scope ("Start / Pause / Resume / Stop; follow behavior") which never
 * asks for the full search filter surface in live mode.
 */
public record FollowRequest(String sourceId, List<String> services) {

  public FollowRequest {
    services = services == null ? List.of() : List.copyOf(services);
  }
}
