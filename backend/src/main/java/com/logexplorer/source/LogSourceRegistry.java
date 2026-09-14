package com.logexplorer.source;

import com.logexplorer.config.SourcesProperties;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Component;

/**
 * Resolves stable source IDs to {@link LogSource} implementations
 * (HANDOVER.md §7). Spring autowires every {@link LogSource} bean present
 * in the context — Phase C/D/A2b each just register their own bean, no
 * change needed here.
 */
@Component
public class LogSourceRegistry {

  private final Map<String, LogSource> sources;
  private final SourcesProperties properties;

  public LogSourceRegistry(List<LogSource> sources, SourcesProperties properties) {
    Map<String, LogSource> byId = new LinkedHashMap<>();
    for (LogSource source : sources) {
      byId.put(source.id(), source);
    }
    this.sources = Map.copyOf(byId);
    this.properties = properties;
  }

  /** Every non-disabled source, for {@code GET /api/v1/sources}. */
  public List<LogSource> all() {
    return sources.values().stream()
        .filter(s -> !properties.getDisabled().contains(s.id()))
        .toList();
  }

  /**
   * @throws UnknownSourceException no bean registered under this id
   * @throws DisabledSourceException a bean exists but is disabled by config
   */
  public LogSource require(String id) {
    if (properties.getDisabled().contains(id)) {
      throw new DisabledSourceException(id);
    }
    LogSource source = sources.get(id);
    if (source == null) {
      throw new UnknownSourceException(id);
    }
    return source;
  }

  /**
   * Owner mission "Project-Scoped Schema Scan" §7 — a non-throwing lookup
   * for best-effort, no-network-I/O callers (currently only {@code
   * core.mapping.MappingScopeResolver}, resolving a field-mapping scope
   * key) that must never fail just because a caller names a source id this
   * registry doesn't currently know about — unlike {@link #require}, never
   * distinguishes "unknown" from "disabled," since neither case should
   * ever surface as a 404/error for a purely local, no-I/O profile lookup.
   */
  public Optional<LogSource> find(String id) {
    return Optional.ofNullable(sources.get(id));
  }
}
