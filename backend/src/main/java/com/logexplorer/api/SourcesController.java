package com.logexplorer.api;

import com.logexplorer.api.dto.SourceDto;
import com.logexplorer.core.model.ServiceInfo;
import com.logexplorer.core.model.SourceHealth;
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

  @GetMapping("/{id}/health")
  public Mono<SourceHealth> health(@PathVariable String id) {
    return Mono.defer(() -> registry.require(id).health());
  }

  @GetMapping("/{id}/services")
  public Flux<ServiceInfo> services(@PathVariable String id) {
    return Flux.defer(() -> registry.require(id).discoverServices());
  }
}
