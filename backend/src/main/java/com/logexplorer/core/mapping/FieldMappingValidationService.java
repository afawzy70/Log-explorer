package com.logexplorer.core.mapping;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * Validates a PROPOSED set of candidate paths (raw strings, exactly as the
 * user typed them in the mapping editor — not yet committed to {@link
 * FieldMappingProfileService}) against a bounded set of real Original
 * Source JSON samples (mission §16 — "The user must be able to validate the
 * profile against real sampled events"; mission §14 step 6, "Validate
 * mapping," happens before step 8 "Save mapping").
 *
 * <p>Stateless: takes the proposed candidates and the raw sample strings as
 * input, computes a report, returns it — nothing here is persisted or
 * logged (mission §4/§20).
 *
 * <p>Deliberately shows real, unmasked resolved values in the report
 * (mission §16's own worked example: {@code "CIF -> 2449"}) — the explicit,
 * owner-approved exception for the privileged mapping-setup surface
 * (mission §4: "the mapping setup must show the original JSON AS-IS...
 * ORIGINAL_MAPPING_SAMPLE != NORMAL_SEARCH_RESPONSE"). This service is
 * never on the normal {@code /search} response path.
 */
@Service
public class FieldMappingValidationService {

  /** Hard cap on how many example values are echoed back per field, even against a large sample set. */
  private static final int MAX_EXAMPLES_PER_FIELD = 3;

  private final ObjectMapper objectMapper;

  public FieldMappingValidationService(ObjectMapper objectMapper) {
    this.objectMapper = objectMapper;
  }

  /**
   * @param proposedCandidatesRaw one entry per {@link CanonicalField} the caller wants
   *     validated, each an ordered list of raw path strings exactly as the user typed
   *     them (mission §21 syntax) — a field the caller omits is treated as "no change,"
   *     resolved using {@code fallback}'s existing candidates for that field instead, so
   *     a partial edit (one field changed) can still be validated in full context.
   */
  public MappingValidationReport validate(
      Map<CanonicalField, List<String>> proposedCandidatesRaw, FieldMappingProfile fallback, List<String> rawSamples) {
    List<Map<String, Object>> parsedSamples = new ArrayList<>();
    int malformedSampleCount = 0;
    for (String raw : rawSamples) {
      Map<String, Object> parsed = tryParse(raw);
      if (parsed != null) {
        parsedSamples.add(parsed);
      } else {
        malformedSampleCount++;
      }
    }

    List<FieldValidation> fieldReports = new ArrayList<>();
    Map<CanonicalField, List<JsonPath>> resolvedCandidatesForConflictCheck = new LinkedHashMap<>();
    for (CanonicalField field : CanonicalField.values()) {
      List<String> rawPaths = proposedCandidatesRaw.containsKey(field)
          ? proposedCandidatesRaw.get(field)
          : fallback.candidates(field).stream().map(JsonPath::raw).toList();
      FieldValidation report = validateField(field, rawPaths, parsedSamples);
      fieldReports.add(report);
      resolvedCandidatesForConflictCheck.put(field, parseValidOnly(rawPaths));
    }

    List<ConflictingCandidate> conflicts = findConflicts(resolvedCandidatesForConflictCheck);

    boolean anyInvalidPath = fieldReports.stream().anyMatch(f -> !f.invalidPaths().isEmpty());
    boolean passed = !anyInvalidPath;

    return new MappingValidationReport(
        fieldReports, conflicts, parsedSamples.size(), malformedSampleCount, passed);
  }

  private FieldValidation validateField(CanonicalField field, List<String> rawPaths, List<Map<String, Object>> samples) {
    List<JsonPath> validCandidates = new ArrayList<>();
    List<String> invalidPaths = new ArrayList<>();
    for (String raw : rawPaths) {
      try {
        validCandidates.add(JsonPath.parse(raw));
      } catch (InvalidJsonPathException e) {
        invalidPaths.add(raw);
      }
    }

    int foundCount = 0;
    boolean structuredWarning = false;
    List<String> examples = new ArrayList<>();
    for (Map<String, Object> sample : samples) {
      FieldMappingResolver.ResolvedField resolved = FieldMappingResolver.resolveWithProvenance(sample, validCandidates);
      if (resolved.value() != null && !resolved.value().isEmpty()) {
        foundCount++;
        if (examples.size() < MAX_EXAMPLES_PER_FIELD && !examples.contains(resolved.value())) {
          examples.add(resolved.value());
        }
      }
      if (!validCandidates.isEmpty()
          && JsonPathResolver.isStructuredValue(sample, validCandidates.get(validCandidates.size() - 1))) {
        structuredWarning = true;
      }
    }

    return new FieldValidation(field, rawPaths, invalidPaths, samples.size(), foundCount, structuredWarning, examples);
  }

  private List<JsonPath> parseValidOnly(List<String> rawPaths) {
    List<JsonPath> parsed = new ArrayList<>();
    for (String raw : rawPaths) {
      try {
        parsed.add(JsonPath.parse(raw));
      } catch (InvalidJsonPathException ignored) {
        // Already reported as an invalidPaths entry for this field — excluded here so an
        // unparseable string can never masquerade as a real conflicting candidate.
      }
    }
    return parsed;
  }

  private List<ConflictingCandidate> findConflicts(Map<CanonicalField, List<JsonPath>> candidatesByField) {
    Map<String, List<CanonicalField>> byPath = new LinkedHashMap<>();
    for (Map.Entry<CanonicalField, List<JsonPath>> entry : candidatesByField.entrySet()) {
      for (JsonPath path : entry.getValue()) {
        byPath.computeIfAbsent(path.raw(), k -> new ArrayList<>()).add(entry.getKey());
      }
    }
    List<ConflictingCandidate> conflicts = new ArrayList<>();
    for (Map.Entry<String, List<CanonicalField>> entry : byPath.entrySet()) {
      if (entry.getValue().size() > 1) {
        conflicts.add(new ConflictingCandidate(entry.getKey(), List.copyOf(entry.getValue())));
      }
    }
    return conflicts;
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> tryParse(String raw) {
    if (raw == null) {
      return null;
    }
    try {
      Object value = objectMapper.readValue(raw, new TypeReference<LinkedHashMap<String, Object>>() { });
      return value instanceof Map ? (Map<String, Object>) value : null;
    } catch (Exception e) {
      return null;
    }
  }

  /** One canonical field's validation result. {@code exampleValues} are real, unmasked values — see class javadoc. */
  public record FieldValidation(
      CanonicalField field,
      List<String> candidatePathsRaw,
      List<String> invalidPaths,
      int sampleCount,
      int foundCount,
      boolean structuredValueWarning,
      List<String> exampleValues) {

    public boolean foundInAnySample() {
      return foundCount > 0;
    }

    public boolean mappedButAbsent() {
      return !candidatePathsRaw.isEmpty() && invalidPaths.isEmpty() && foundCount == 0 && sampleCount > 0;
    }
  }

  /** The same source path claimed as a candidate by more than one canonical field — reported, never silently allowed to be ambiguous. */
  public record ConflictingCandidate(String pathRaw, List<CanonicalField> fields) {
  }

  /** @param passed {@code true} iff no candidate path anywhere failed to parse — the gate {@link FieldMappingProfileService#confirmSave} requires. */
  public record MappingValidationReport(
      List<FieldValidation> fields,
      List<ConflictingCandidate> conflicts,
      int sampleCount,
      int malformedSampleCount,
      boolean passed) {
  }
}
