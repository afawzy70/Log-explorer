package com.logexplorer.api.live;

import java.util.List;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;

/**
 * {@code GET /api/v1/logs/live} - Server-Sent Events (IMPLEMENTATION_PLAN.md
 * "Phase J", HANDOVER.md §18.1: "Server-to-browser live events use SSE").
 * {@code GET} with only {@code sourceId}/{@code services} in the query
 * string - neither is sensitive, and there is nowhere else to put them:
 * the browser's native {@code EventSource} can only ever issue a bodiless
 * {@code GET} (CLAUDE.md §2 rule 4 "nothing sensitive in URLs" holds
 * because live tail's own scope never accepts a token, a sensitive
 * filter, or free text to begin with - see {@code FollowRequest}'s own
 * comment).
 */
@RestController
@RequestMapping("/api/v1/logs")
public class LiveTailController {

  private final LiveTailService service;

  public LiveTailController(LiveTailService service) {
    this.service = service;
  }

  @GetMapping(value = "/live", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
  public Flux<ServerSentEvent<Object>> live(
      @RequestParam String sourceId,
      @RequestParam(required = false) String services) {
    List<String> serviceList = services == null || services.isBlank()
        ? List.of()
        : List.of(services.split(","));
    return service.follow(sourceId, serviceList);
  }
}
