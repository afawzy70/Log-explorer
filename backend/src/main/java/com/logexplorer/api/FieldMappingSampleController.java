package com.logexplorer.api;

import com.logexplorer.api.dto.FieldMappingSampleResponseDto;
import com.logexplorer.core.mapping.sample.FieldMappingSampleService;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * Original Source JSON sample fetch (mission "Configurable Log Field
 * Mapping + Original JSON Sampling" §5) — nested under {@code /sources/
 * {sourceId}} (unlike the source-independent {@link
 * FieldMappingSettingsController}) because a sample is inherently tied to
 * one specific source's own current data. {@code POST}, not {@code GET},
 * because this triggers a real (bounded) read against the live source —
 * the same convention {@code SearchController}'s own {@code /search}
 * endpoint already uses for a request with real side effects on the wire
 * (a network call), even though nothing here is mutated.
 *
 * <p>Stateless — see {@link FieldMappingSampleService}'s own javadoc for
 * why nothing is cached or retained server-side between calls.
 */
@RestController
@RequestMapping("/api/v1/sources/{sourceId}/field-mapping")
public class FieldMappingSampleController {

  private final FieldMappingSampleService sampleService;

  public FieldMappingSampleController(FieldMappingSampleService sampleService) {
    this.sampleService = sampleService;
  }

  @PostMapping("/samples")
  public Mono<FieldMappingSampleResponseDto> fetchSamples(
      @PathVariable String sourceId, @RequestParam(required = false) Integer limit) {
    int requestedLimit = limit == null ? FieldMappingSampleService.DEFAULT_LIMIT : limit;
    return sampleService.fetchSamples(sourceId, limit)
        .map(samples -> new FieldMappingSampleResponseDto(sourceId, requestedLimit, samples.size(), samples));
  }
}
