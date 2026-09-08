package com.logexplorer.api;

import com.logexplorer.api.dto.SearchRequestDto;
import com.logexplorer.api.dto.SearchResponseDto;
import jakarta.validation.Valid;
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
            result.nextCursor()));
  }
}
