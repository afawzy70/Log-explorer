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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

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

  /**
   * UX-R3 §7/§8 — {@code composeProject}, when supplied, scopes discovery
   * to that one project (the same hard boundary every other Docker
   * operation already enforces via {@code DockerLogSource#relevantContainers}).
   * Ignored entirely by sources without a real Compose-project concept.
   */
  @GetMapping("/{id}/services")
  public Flux<ServiceInfo> services(@PathVariable String id, @RequestParam(required = false) String composeProject) {
    return Flux.defer(() -> registry.require(id).discoverServices(composeProject));
  }

  /**
   * UX-R3 §7 — real, currently-visible Docker Compose projects on this
   * source's own connection (empty for a source with no Compose-project
   * concept at all, e.g. Fixture/Loki - the frontend uses {@link
   * com.logexplorer.core.model.SourceCapabilities#composeProjectScoping()}
   * to tell that apart from "reachable but genuinely zero projects
   * right now", never this list's emptiness alone). One on-demand call
   * per discovery attempt (Settings' own Test Connection/refresh flow) -
   * deliberately not polled continuously (UX-R3 §23 performance).
   * {@link LogSource#discoverComposeProjects()} is a blocking Docker
   * client call, so it is explicitly moved off the WebFlux event loop
   * here, the same rule every other Docker operation in this codebase
   * already follows.
   */
  @GetMapping("/{id}/compose-projects")
  public Mono<List<String>> composeProjects(@PathVariable String id) {
    return Mono.fromCallable(() -> registry.require(id).discoverComposeProjects())
        .subscribeOn(Schedulers.boundedElastic());
  }
}
