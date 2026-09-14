package com.logexplorer.api;

import com.logexplorer.api.dto.FieldMappingCandidatesUpdateRequestDto;
import com.logexplorer.api.dto.FieldMappingProfileDto;
import com.logexplorer.api.dto.FieldMappingSaveRequestDto;
import com.logexplorer.api.dto.FieldMappingValidationReportDto;
import com.logexplorer.api.dto.FieldMappingValidationRequestDto;
import com.logexplorer.core.mapping.CanonicalField;
import com.logexplorer.core.mapping.FieldMappingProfile;
import com.logexplorer.core.mapping.FieldMappingProfileService;
import com.logexplorer.core.mapping.FieldMappingValidationService;
import com.logexplorer.core.mapping.InvalidJsonPathException;
import com.logexplorer.core.mapping.JsonPath;
import com.logexplorer.core.mapping.MappingScopeKey;
import com.logexplorer.core.mapping.MappingScopeResolver;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Log Schema & Field Mapping settings (mission "Configurable Log Field
 * Mapping + Original JSON Sampling" §14) — deliberately its own top-level,
 * source-independent endpoint ({@code /api/v1/settings/field-mapping}), the
 * same placement discipline {@link MaskingSettingsController} already
 * established for a cross-cutting settings concern. Same unauthenticated-
 * local-tool trust model as every other settings endpoint (see that
 * controller's own doc comment) — the person running the backend and the
 * person using the browser are the same person on the same machine.
 *
 * <p><b>Project-scoped</b> (owner mission "Project-Scoped Schema Scan"
 * §7/§8): every endpoint now accepts optional {@code sourceId}/{@code
 * project} query parameters, resolved via {@link MappingScopeResolver} into
 * the exact same {@link MappingScopeKey} real search/scan traffic uses —
 * never a client-trusted label alone for a source (OpenShift) whose real
 * scope is server-side session state. Omitting both falls back to {@link
 * MappingScopeKey#UNSPECIFIED} (the legacy/global scope) — a caller that
 * doesn't know its scope yet still gets a safe, working default rather than
 * an error, but every real frontend call now always supplies both.
 *
 * <p>All request/response bodies here — including {@link
 * FieldMappingValidationRequestDto#samples} and {@link
 * FieldMappingValidationReportDto}'s example values — carry real, unmasked
 * Original Source JSON content by deliberate owner decision (mission §4).
 * Never logged: see {@code FieldMappingSettingsLeakTest}.
 */
@RestController
@RequestMapping("/api/v1/settings/field-mapping")
public class FieldMappingSettingsController {

  private final FieldMappingProfileService profileService;
  private final FieldMappingValidationService validationService;
  private final MappingScopeResolver scopeResolver;

  public FieldMappingSettingsController(
      FieldMappingProfileService profileService, FieldMappingValidationService validationService,
      MappingScopeResolver scopeResolver) {
    this.profileService = profileService;
    this.validationService = validationService;
    this.scopeResolver = scopeResolver;
  }

  @GetMapping
  public FieldMappingProfileDto current(
      @RequestParam(required = false) String sourceId, @RequestParam(required = false) String project) {
    MappingScopeKey scope = scopeResolver.resolve(sourceId, project);
    return toDto(scope, profileService.activeProfile(scope), profileService.isModifiedFromDefault(scope), profileService.isSearchReady(scope));
  }

  @PutMapping("/fields/{field}")
  public FieldMappingProfileDto updateField(
      @PathVariable String field,
      @RequestParam(required = false) String sourceId,
      @RequestParam(required = false) String project,
      @RequestBody FieldMappingCandidatesUpdateRequestDto request) {
    MappingScopeKey scope = scopeResolver.resolve(sourceId, project);
    CanonicalField canonicalField = resolveField(field);
    List<JsonPath> candidates = parseCandidatesOrReject(request.candidatePaths());
    profileService.updateCandidates(scope, canonicalField, candidates);
    return toDto(scope, profileService.activeProfile(scope), profileService.isModifiedFromDefault(scope), profileService.isSearchReady(scope));
  }

  @PostMapping("/reset")
  public FieldMappingProfileDto reset(
      @RequestParam(required = false) String sourceId, @RequestParam(required = false) String project) {
    MappingScopeKey scope = scopeResolver.resolve(sourceId, project);
    FieldMappingProfile def = profileService.resetToDefault(scope);
    return toDto(scope, def, profileService.isModifiedFromDefault(scope), profileService.isSearchReady(scope));
  }

  @PostMapping("/validate")
  public FieldMappingValidationReportDto validate(
      @RequestParam(required = false) String sourceId, @RequestParam(required = false) String project,
      @RequestBody FieldMappingValidationRequestDto request) {
    MappingScopeKey scope = scopeResolver.resolve(sourceId, project);
    Map<CanonicalField, List<String>> proposed = new EnumMap<>(CanonicalField.class);
    if (request.proposedCandidates() != null) {
      for (Map.Entry<String, List<String>> entry : request.proposedCandidates().entrySet()) {
        proposed.put(resolveField(entry.getKey()), entry.getValue());
      }
    }
    List<String> samples = request.samples() == null ? List.of() : request.samples();
    FieldMappingValidationService.MappingValidationReport report =
        validationService.validate(proposed, profileService.activeProfile(scope), samples);
    return toReportDto(report);
  }

  @PostMapping("/save")
  public FieldMappingProfileDto save(
      @RequestParam(required = false) String sourceId, @RequestParam(required = false) String project,
      @RequestBody FieldMappingSaveRequestDto request) {
    MappingScopeKey scope = scopeResolver.resolve(sourceId, project);
    boolean validationPassed = Boolean.TRUE.equals(request.validationPassed());
    profileService.confirmSave(scope, validationPassed);
    return toDto(scope, profileService.activeProfile(scope), profileService.isModifiedFromDefault(scope), profileService.isSearchReady(scope));
  }

  private CanonicalField resolveField(String key) {
    try {
      return CanonicalField.byKey(key);
    } catch (IllegalArgumentException e) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown canonical field: '" + key + "'");
    }
  }

  private List<JsonPath> parseCandidatesOrReject(List<String> rawPaths) {
    if (rawPaths == null) {
      return List.of();
    }
    List<JsonPath> parsed = new ArrayList<>();
    for (String raw : rawPaths) {
      try {
        parsed.add(JsonPath.parse(raw));
      } catch (InvalidJsonPathException e) {
        // Mission §21: "Invalid paths must fail safely" - a 400, never a
        // 500 and never a silently-dropped candidate.
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid path '" + raw + "': " + e.getMessage());
      }
    }
    return parsed;
  }

  private FieldMappingProfileDto toDto(MappingScopeKey scope, FieldMappingProfile profile, boolean modified, boolean ready) {
    List<FieldMappingProfileDto.CanonicalFieldMappingDto> fields = new ArrayList<>();
    for (CanonicalField field : CanonicalField.values()) {
      fields.add(new FieldMappingProfileDto.CanonicalFieldMappingDto(
          field.key(), field.displayName(), field.sensitive(),
          profile.candidates(field).stream().map(JsonPath::raw).toList()));
    }
    String reportedSourceId = scope == MappingScopeKey.UNSPECIFIED ? null : scope.sourceId();
    return new FieldMappingProfileDto(reportedSourceId, scope.displayScope(), fields, modified, ready);
  }

  private FieldMappingValidationReportDto toReportDto(FieldMappingValidationService.MappingValidationReport report) {
    List<FieldMappingValidationReportDto.FieldValidationDto> fields = report.fields().stream()
        .map(f -> new FieldMappingValidationReportDto.FieldValidationDto(
            f.field().key(), f.field().displayName(), f.candidatePathsRaw(), f.invalidPaths(),
            f.sampleCount(), f.foundCount(), f.foundInAnySample(), f.mappedButAbsent(),
            f.structuredValueWarning(), f.exampleValues()))
        .toList();
    List<FieldMappingValidationReportDto.ConflictDto> conflicts = report.conflicts().stream()
        .map(c -> new FieldMappingValidationReportDto.ConflictDto(
            c.pathRaw(), c.fields().stream().map(CanonicalField::key).toList()))
        .toList();
    return new FieldMappingValidationReportDto(
        fields, conflicts, report.sampleCount(), report.malformedSampleCount(), report.passed());
  }
}
