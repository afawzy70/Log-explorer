package com.logexplorer.api;

import com.logexplorer.api.dto.SourceDto;
import com.logexplorer.api.dto.SourceHealthDto;
import com.logexplorer.core.model.ServiceInfo;
import com.logexplorer.source.LogSource;
import com.logexplorer.source.LogSourceRegistry;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

@RestController
@RequestMapping("/api/v1/sources")
public class SourcesController {

  private final LogSourceRegistry registry;

  public SourcesController(LogSourceRegistry registry) {
    this.registry = registry;
  }

  @GetMapping
  public List<SourceDto> list() {
    return registry.all().stream()
        .map(s -> new SourceDto(s.id(), s.displayName(), s.capabilities()))
        .toList();
  }

  /**
   * Legacy Remediation Slice 6 — the richer health model
   * ({@code docs/verification/LEGACY_REMEDIATION_SLICE_6_REPORT.md}).
   * {@code latencyMs} is measured here, generically for every source, via
   * {@link Mono#elapsed()} — the real wall-clock time between subscribing
   * to {@link LogSource#health()} and its result — rather than each
   * adapter self-instrumenting. {@code capabilities} is attached from the
   * same {@link LogSource#capabilities()} every source already exposes via
   * {@code GET /api/v1/sources}, so one health payload carries a complete,
   * truthful picture without a second round trip.
   */
  @GetMapping("/{id}/health")
  public Mono<SourceHealthDto> health(@PathVariable String id) {
    return Mono.defer(() -> {
      LogSource source = registry.require(id);
      return source.health()
          .elapsed()
          .map(timed -> SourceHealthDto.of(timed.getT2(), timed.getT1(), source.capabilities()));
    });
  }

  @GetMapping("/{id}/services")
  public Flux<ServiceInfo> services(@PathVariable String id) {
    return Flux.defer(() -> registry.require(id).discoverServices());
  }
}
