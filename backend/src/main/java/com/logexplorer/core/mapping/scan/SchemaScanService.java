package com.logexplorer.core.mapping.scan;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.core.mapping.CanonicalField;
import com.logexplorer.core.mapping.FieldMappingProfile;
import com.logexplorer.core.mapping.FieldMappingProfileService;
import com.logexplorer.core.mapping.JsonPath;
import com.logexplorer.core.mapping.MappingScopeKey;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.source.LogSource;
import com.logexplorer.source.LogSourceRegistry;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Mono;

/**
 * The Quick Schema Scan engine (owner mission "Field Mapping Schema Scan +
 * Masking Policy Extension" §A, project-scoped per owner mission
 * "Project-Scoped Schema Scan" §1-§6) — extends {@code
 * core.mapping.sample.FieldMappingSampleService}'s simple bounded-sample-
 * fetch idea into a real discovery pass: severity/structure-diverse
 * inspection across up to {@link SchemaScanBounds#DEFAULT_MAX_EVENTS_INSPECTED}
 * (bounded {@link SchemaScanBounds#MAX_EVENTS_INSPECTED_CEILING}) recent
 * events <b>within the caller-selected logical scope only</b>, a bounded
 * representative raw sample set (structured events only — mission §5), and
 * a full "Discovered Source Schema" path union with per-path occurrence
 * statistics.
 *
 * <p><b>Scope is explicit, never indiscriminate</b> (mission §1 —
 * "SCAN_SCOPE_EXPLICIT"): {@code composeProject} is threaded straight onto
 * the {@link SearchRequest} this scan builds, exactly like a normal search
 * request — {@code source.docker.DockerLogSource} already filters strictly
 * to that one Compose project (mission §2), never mixing others in. For a
 * source whose real scope is resolved server-side instead of from the
 * request (OpenShift's currently-connected/selected project — mission
 * §3), {@link LogSource#resolveMappingScopeLabel} is the single source of
 * truth this class defers to for BOTH the reported {@code scopeLabel} and
 * the {@link MappingScopeKey} used for the saved-mapping cross-reference —
 * the exact same value {@code core.parse.LogLineParser} will resolve for
 * real parsing, so a scan and the mapping profile it reports against are
 * always keyed identically (mission §7/§8: never silently reusing another
 * project's mapping).
 *
 * <p><b>Structured vs. noise</b> (mission §5): every inspected event is
 * classified {@link EventClassification#STRUCTURED_JSON_APPLICATION_EVENT}
 * or {@link EventClassification#NON_JSON_OR_MALFORMED_EVENT}. Only
 * structured events ever contribute a path to the Discovered Source Schema
 * or become a {@code representativeEvents} sample; non-JSON/malformed
 * lines (an nginx/Loki-style access line, a fixture's own deliberately-
 * malformed line) are retained separately, in a small diagnostics-only
 * list, and can never become "the" representative sample driving field
 * mapping.
 *
 * <p><b>Stateless</b> — exactly like {@code FieldMappingSampleService},
 * nothing is cached or retained here between calls; every scan re-reads
 * from the source's own already-bounded {@link LogSource#search}. Reading
 * {@link FieldMappingProfileService#activeProfile(MappingScopeKey)} for the
 * {@code mappedPathsNotObserved} cross-reference is a read-only lookup of
 * another stateless-in-memory service's current value, never a write — a
 * scan can never mutate the saved mapping (mission §A9: "must NOT silently
 * overwrite the saved field mapping").
 *
 * <p><b>Never on the normal search response path</b> — reads {@link
 * CanonicalLogEvent#originalRawJson()}, exactly like {@code
 * FieldMappingSampleService}, and is subject to the same {@code
 * ORIGINAL_MAPPING_SAMPLE != NORMAL_SEARCH_RESPONSE} boundary.
 */
@Service
public class SchemaScanService {

  private final LogSourceRegistry registry;
  private final FieldMappingProfileService mappingProfileService;
  private final ObjectMapper objectMapper;
  private final Clock clock;

  @Autowired
  public SchemaScanService(LogSourceRegistry registry, FieldMappingProfileService mappingProfileService) {
    this(registry, mappingProfileService, new ObjectMapper(), Clock.systemUTC());
  }

  /** Test-only constructor — injects a fake {@link Clock} so duration-bound behavior is deterministically testable. */
  SchemaScanService(LogSourceRegistry registry, FieldMappingProfileService mappingProfileService,
      ObjectMapper objectMapper, Clock clock) {
    this.registry = registry;
    this.mappingProfileService = mappingProfileService;
    this.objectMapper = objectMapper;
    this.clock = clock;
  }

  /**
   * Runs a bounded Quick Schema Scan against {@code sourceId}'s own recent
   * history, restricted to {@code composeProject} when the source has a
   * real project concept (mission §1/§2) — {@code null}/blank means "no
   * project filter," the source's own default scope (never "scan
   * everything, ignore scope" for a source that DOES have a selected
   * project; see {@link com.logexplorer.source.docker.DockerLogSource}'s
   * own {@code relevantContainers} for the actual isolation mechanism).
   */
  public Mono<SchemaScanResult> scan(String sourceId, String composeProject, Integer requestedMaxEvents) {
    LogSource source = registry.require(sourceId);
    int maxEvents = clampEvents(requestedMaxEvents);

    Instant now = clock.instant();
    SearchRequest request = SearchRequest.builder()
        .sourceId(sourceId)
        .start(now.minus(Duration.ofDays(30)))
        .end(now)
        .direction(SearchRequest.Direction.BACKWARD) // newest first - the most useful recent shapes
        .limit(maxEvents)
        .composeProject(composeProject)
        .build();

    // Mission §8: the SAME resolved scope label real parsing/search-
    // readiness will use for this exact request - never independently
    // guessed here.
    String scopeLabel = source.resolveMappingScopeLabel(request);
    MappingScopeKey scopeKey = MappingScopeKey.of(sourceId, scopeLabel);

    return source.search(request)
        .take(maxEvents) // never unbounded, regardless of what this source's own search() returns
        .collectList()
        .map(events -> buildResult(sourceId, scopeLabel, scopeKey, events, maxEvents));
  }

  private int clampEvents(Integer requested) {
    int value = requested == null ? SchemaScanBounds.DEFAULT_MAX_EVENTS_INSPECTED : requested;
    if (value < 0) {
      value = 0;
    }
    return Math.min(value, SchemaScanBounds.MAX_EVENTS_INSPECTED_CEILING);
  }

  private SchemaScanResult buildResult(
      String sourceId, String scopeLabel, MappingScopeKey scopeKey, List<CanonicalLogEvent> events, int maxEvents) {
    Instant scanStart = clock.instant();

    Map<String, Set<ObservedType>> observedTypesByPath = new LinkedHashMap<>();
    Map<String, Integer> occurrenceByPath = new LinkedHashMap<>();
    List<OriginalEventSample> representative = new ArrayList<>();
    List<OriginalEventSample> diagnosticNonJson = new ArrayList<>();
    Set<String> seenRepresentativeKeys = new HashSet<>();
    Set<String> structuralVariants = new HashSet<>();
    Set<String> servicesObserved = new TreeSet<>();

    int totalInspected = 0;
    int structuredCount = 0;
    int nonJsonCount = 0;
    long bytesInspected = 0;
    boolean eventLimitReached = false;
    boolean byteLimitReached = false;
    boolean durationLimitReached = false;

    for (CanonicalLogEvent event : events) {
      if (Duration.between(scanStart, clock.instant()).compareTo(SchemaScanBounds.MAX_SCAN_DURATION) > 0) {
        durationLimitReached = true;
        break;
      }

      String rawJson = event.originalRawJson();
      long size = rawJson == null ? 0 : rawJson.getBytes(StandardCharsets.UTF_8).length;
      if (totalInspected > 0 && bytesInspected + size > SchemaScanBounds.MAX_BYTES_INSPECTED) {
        byteLimitReached = true;
        break;
      }

      totalInspected++;
      bytesInspected += size;

      String severity = normalizeSeverity(event.severity());
      Map<String, Object> parsed = tryParse(rawJson);
      boolean structured = parsed != null;
      EventClassification classification = structured
          ? EventClassification.STRUCTURED_JSON_APPLICATION_EVENT
          : EventClassification.NON_JSON_OR_MALFORMED_EVENT;
      Map<String, ObservedType> pathTypes = structured ? JsonSchemaWalker.walk(parsed) : Map.of();

      if (structured) {
        structuredCount++;
        if (event.service() != null && !event.service().isBlank()) {
          servicesObserved.add(event.service());
        }
        for (Map.Entry<String, ObservedType> entry : pathTypes.entrySet()) {
          observedTypesByPath
              .computeIfAbsent(entry.getKey(), k -> EnumSet.noneOf(ObservedType.class))
              .add(entry.getValue());
          occurrenceByPath.merge(entry.getKey(), 1, Integer::sum);
        }
      } else {
        nonJsonCount++;
      }

      StructuralSignature signature = structured ? StructuralSignature.of(pathTypes.keySet()) : StructuralSignature.malformed();
      if (structured) {
        structuralVariants.add(signature.fingerprint());
      }

      if (structured) {
        String representativeKey = severity + "|" + signature.fingerprint();
        if (representative.size() < SchemaScanBounds.MAX_REPRESENTATIVE_EVENTS && seenRepresentativeKeys.add(representativeKey)) {
          representative.add(new OriginalEventSample(rawJson, severity, classification, signature.fingerprint()));
        }
      } else if (diagnosticNonJson.size() < SchemaScanBounds.MAX_DIAGNOSTIC_NON_JSON_SAMPLES) {
        // Mission §5: diagnostics only - never deduplicated by shape (a
        // non-JSON line has no real "shape" to dedupe by), never eligible
        // to become a representative mapping sample.
        diagnosticNonJson.add(new OriginalEventSample(rawJson, severity, classification, signature.fingerprint()));
      }
    }

    // True only when the source had at least maxEvents available AND
    // nothing else (byte/duration bound) cut the loop short first - i.e.
    // the event count itself was the actual limiting factor.
    eventLimitReached = !durationLimitReached && !byteLimitReached
        && events.size() >= maxEvents && maxEvents > 0;

    List<DiscoveredPathEntry> discovered = new ArrayList<>();
    for (Map.Entry<String, Set<ObservedType>> entry : observedTypesByPath.entrySet()) {
      String path = entry.getKey();
      int count = occurrenceByPath.get(path);
      double percentage = totalInspected == 0 ? 0.0 : (count * 100.0) / totalInspected;
      discovered.add(new DiscoveredPathEntry(path, entry.getValue(), count, percentage));
    }
    discovered.sort((a, b) -> a.path().compareTo(b.path()));

    List<String> mappedPathsNotObserved = computeMappedPathsNotObserved(scopeKey, discovered);

    return new SchemaScanResult(
        sourceId,
        scopeLabel,
        List.copyOf(servicesObserved),
        totalInspected,
        structuredCount,
        nonJsonCount,
        structuralVariants.size(),
        bytesInspected,
        eventLimitReached,
        byteLimitReached,
        durationLimitReached,
        representative,
        diagnosticNonJson,
        discovered,
        mappedPathsNotObserved);
  }

  private List<String> computeMappedPathsNotObserved(MappingScopeKey scopeKey, List<DiscoveredPathEntry> discovered) {
    Set<String> discoveredPaths = new HashSet<>();
    for (DiscoveredPathEntry entry : discovered) {
      discoveredPaths.add(entry.path());
    }
    List<String> missing = new ArrayList<>();
    FieldMappingProfile profile = mappingProfileService.activeProfile(scopeKey);
    for (CanonicalField field : CanonicalField.values()) {
      for (JsonPath candidate : profile.candidates(field)) {
        if (!discoveredPaths.contains(candidate.raw()) && !missing.contains(candidate.raw())) {
          missing.add(candidate.raw());
        }
      }
    }
    return missing;
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> tryParse(String rawJson) {
    if (rawJson == null || rawJson.isBlank()) {
      return null;
    }
    try {
      Object value = objectMapper.readValue(rawJson, Object.class);
      if (value instanceof Map<?, ?> map) {
        return (Map<String, Object>) map;
      }
      return null;
    } catch (Exception ex) {
      return null;
    }
  }

  private String normalizeSeverity(String severity) {
    return severity == null || severity.isBlank() ? "UNKNOWN" : severity.toUpperCase(Locale.ROOT);
  }
}
