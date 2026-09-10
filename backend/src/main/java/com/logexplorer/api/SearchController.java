package com.logexplorer.api;

import com.logexplorer.api.dto.ContextRequestDto;
import com.logexplorer.api.dto.JourneyRequestDto;
import com.logexplorer.api.dto.QueryPlanDto;
import com.logexplorer.api.dto.SearchRequestDto;
import com.logexplorer.api.dto.SearchResponseDto;
import com.logexplorer.core.model.CanonicalLogEvent;
import jakarta.validation.Valid;
import java.util.Comparator;
import java.util.List;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

@RestController
@RequestMapping("/api/v1/logs")
public class SearchController {

  private final SearchService searchService;
  private final RequestMapper requestMapper;
  private final EventMapper eventMapper;

  public SearchController(SearchService searchService, RequestMapper requestMapper, EventMapper eventMapper) {
    this.searchService = searchService;
    this.requestMapper = requestMapper;
    this.eventMapper = eventMapper;
  }

  @PostMapping("/search")
  public Mono<SearchResponseDto> search(@Valid @RequestBody SearchRequestDto dto) {
    return searchService.search(requestMapper.toDomain(dto))
        .map(result -> new SearchResponseDto(
            result.events().stream().map(eventMapper::toDto).toList(),
            result.counts(),
            result.nextCursor(),
            QueryPlanDto.from(result.queryPlan())));
  }

  /**
   * "Show ±30 seconds" (IMPLEMENTATION_PLAN.md "Phase H", HANDOVER.md
   * §16.7) — a bounded, server-computed window around one event, reusing
   * the exact same {@link SearchService}/guardrail/masking pipeline as
   * {@link #search}, so its response is the identical {@link
   * SearchResponseDto} shape the results table already renders.
   */
  @PostMapping("/context")
  public Mono<SearchResponseDto> context(@Valid @RequestBody ContextRequestDto dto) {
    return searchService.search(requestMapper.toContextDomain(dto))
        .map(result -> new SearchResponseDto(
            result.events().stream().map(eventMapper::toDto).toList(),
            result.counts(),
            result.nextCursor(),
            QueryPlanDto.from(result.queryPlan())));
  }

  /**
   * "Timeline ... ascending order for flow" (IMPLEMENTATION_PLAN.md "Phase
   * I", HANDOVER.md §17) — ascending order is enforced once, here, for
   * every source alike, so this endpoint's contract never depends on any
   * adapter's own ordering.
   *
   * <p><b>Corrected in UX-R4.</b> This comment previously claimed that
   * "only {@code LokiLogSource} honors {@link
   * com.logexplorer.core.model.SearchRequest#direction()} at all;
   * fixture/Docker always return newest-first". That is no longer true and
   * has not been since the Legacy Remediation Slice 1 recovery: {@code
   * FixtureLogSource} and {@code DockerLogSource} both sort/merge in
   * direction-of-travel order, and {@code PageCursorCodec} binds the
   * direction into the cursor's own request-binding fingerprint. Verified
   * empirically against the running backend before UX-R4 wired the
   * frontend's Newest/Oldest control to it — both directions, across page
   * boundaries, with no duplicates and no gaps. The stale claim mattered
   * because it would have talked a future reader out of trusting
   * source-side sorting and into faking it client-side, which CLAUDE.md
   * §4 and UX-R4 §11 both forbid. Malformed events (no parsed timestamp) sort
   * last, never dropped (CLAUDE.md §4 "malformed lines ... never silently
   * dropped").
   */
  @PostMapping("/journey")
  public Mono<SearchResponseDto> journey(@Valid @RequestBody JourneyRequestDto dto) {
    return searchService.search(requestMapper.toJourneyDomain(dto))
        .map(result -> {
          List<CanonicalLogEvent> ascending = result.events().stream()
              .sorted(Comparator.comparing(CanonicalLogEvent::timestamp, Comparator.nullsLast(Comparator.naturalOrder())))
              .toList();
          return new SearchResponseDto(
              ascending.stream().map(eventMapper::toDto).toList(),
              result.counts(),
              result.nextCursor(),
              QueryPlanDto.from(result.queryPlan()));
        });
  }
}
