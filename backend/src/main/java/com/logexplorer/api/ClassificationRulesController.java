package com.logexplorer.api;

import com.logexplorer.api.dto.ClassificationRuleWriteRequestDto;
import com.logexplorer.api.dto.ClassificationRulesStateDto;
import com.logexplorer.api.dto.ImportApplyRequestDto;
import com.logexplorer.api.dto.ImportApplyResponseDto;
import com.logexplorer.api.dto.PatternDetectionRequestDto;
import com.logexplorer.api.dto.RuleTestRequestDto;
import com.logexplorer.api.dto.RuleValidationResponseDto;
import com.logexplorer.core.classify.ClassificationEngine;
import com.logexplorer.core.classify.ClassificationLimits;
import com.logexplorer.core.classify.ClassificationPack;
import com.logexplorer.core.classify.ClassificationRule;
import com.logexplorer.core.classify.ClassificationRuleService;
import com.logexplorer.core.classify.ClassificationRulesException;
import com.logexplorer.core.classify.ConflictResolution;
import com.logexplorer.core.classify.FieldRef;
import com.logexplorer.core.classify.ImportMode;
import com.logexplorer.core.classify.RuleCompiler;
import com.logexplorer.core.classify.RuleTester;
import com.logexplorer.core.classify.RuleValidationException;
import com.logexplorer.core.classify.detect.DetectionResult;
import com.logexplorer.core.classify.detect.PatternDetector;
import com.logexplorer.core.mask.ExtractedValueRedactor;
import com.logexplorer.core.mask.TextRedactor;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

/**
 * Event classification rules: management, deterministic pattern detection,
 * rule testing against a bounded real sample, and portable JSON import /
 * export. Mutations carry the revision they were based on; a stale write
 * returns HTTP 409 instead of silently overwriting another window's change.
 *
 * <p>Nothing here persists events, samples, or extracted values — only the
 * rules configuration file changes, and only on explicit save/import.
 */
@RestController
@RequestMapping("/api/v1/settings/classification-rules")
public class ClassificationRulesController {

  private final ClassificationRuleService ruleService;
  private final ClassificationEngine engine;
  private final RuleCompiler compiler;
  private final PatternDetector detector;
  private final RuleTester tester;
  private final ClassificationSampleCollector sampleCollector;
  private final ExtractedValueRedactor redactor;
  private final TextRedactor textRedactor;

  public ClassificationRulesController(ClassificationRuleService ruleService, ClassificationEngine engine,
      RuleCompiler compiler, PatternDetector detector, RuleTester tester, ClassificationSampleCollector sampleCollector,
      ExtractedValueRedactor redactor, TextRedactor textRedactor) {
    this.ruleService = ruleService;
    this.engine = engine;
    this.compiler = compiler;
    this.detector = detector;
    this.tester = tester;
    this.sampleCollector = sampleCollector;
    this.redactor = redactor;
    this.textRedactor = textRedactor;
  }

  @GetMapping
  public ClassificationRulesStateDto state() {
    return toDto(ruleService.state());
  }

  @PostMapping
  public ClassificationRulesStateDto create(@RequestBody ClassificationRuleWriteRequestDto body) {
    return toDto(ruleService.create(body.expectedRevision(), body.rule()));
  }

  @PutMapping("/{id}")
  public ClassificationRulesStateDto update(@PathVariable String id, @RequestBody ClassificationRuleWriteRequestDto body) {
    return toDto(ruleService.update(id, body.expectedRevision(), body.rule()));
  }

  @DeleteMapping("/{id}")
  public ClassificationRulesStateDto delete(@PathVariable String id,
      @RequestParam(required = false) Long expectedRevision) {
    return toDto(ruleService.delete(id, expectedRevision));
  }

  @PostMapping("/validate")
  public RuleValidationResponseDto validate(@RequestBody ClassificationRule rule) {
    try {
      compiler.compile(rule);
      return new RuleValidationResponseDto(true, List.of());
    } catch (RuleValidationException e) {
      return new RuleValidationResponseDto(false, e.errors());
    }
  }

  /** Suggestion only — never saves anything. */
  @PostMapping("/detect")
  public Mono<DetectionResult> detect(@RequestBody PatternDetectionRequestDto body) {
    FieldRef field;
    try {
      field = FieldRef.parse(body.field());
    } catch (IllegalArgumentException e) {
      return Mono.error(ClassificationRulesException.badRequest("FIELD_INVALID", e.getMessage()));
    }
    if (body.anchorValue() == null || body.anchorValue().isBlank()) {
      return Mono.error(ClassificationRulesException.badRequest("ANCHOR_REQUIRED",
          "The selected event has no value for this field"));
    }
    String anchor = truncate(textRedactor.redact(body.anchorValue()), ClassificationLimits.MAX_DETECTION_VALUE_CHARS);
    return sampleCollector.collect(body.scope(), body.sampleSize())
        .publishOn(Schedulers.boundedElastic())
        .map(sample -> {
          List<String> values = sample.events().stream()
              .map(event -> {
                String text = engine.fieldText(field, event);
                return text == null ? null
                    : truncate(redactor.redactText(event, text), ClassificationLimits.MAX_DETECTION_VALUE_CHARS);
              })
              .filter(Objects::nonNull)
              .toList();
          return detector.detect(field.raw(), anchor, values, sample.events().size());
        });
  }

  /** Tests an unsaved rule against a bounded real sample — never persists or activates it. */
  @PostMapping("/test")
  public Mono<RuleTester.RuleTestResult> test(@RequestBody RuleTestRequestDto body) {
    try {
      compiler.compile(body.rule());
    } catch (RuleValidationException e) {
      return Mono.error(e);
    }
    return sampleCollector.collect(body.scope(), body.sampleSize())
        .publishOn(Schedulers.boundedElastic())
        .map(sample -> tester.test(body.rule(), sample.events(), sample.limitReached()));
  }

  @GetMapping("/export")
  public ResponseEntity<byte[]> export(@RequestParam(required = false) List<String> ids,
      @RequestParam(required = false) String name) {
    byte[] pack = ruleService.exportPackBytes(ids, name);
    return ResponseEntity.ok()
        .contentType(MediaType.APPLICATION_JSON)
        .header(HttpHeaders.CONTENT_DISPOSITION,
            ContentDisposition.attachment().filename(ClassificationPack.DEFAULT_FILE_NAME).build().toString())
        .body(pack);
  }

  /** Phase 1 of import: validates and classifies the pack against current rules. Writes nothing. */
  @PostMapping(value = "/import/preview", consumes = MediaType.ALL_VALUE)
  public ClassificationRuleService.ImportPreview previewImport(@RequestBody(required = false) String body) {
    return ruleService.previewImport(body == null ? null : body.getBytes(StandardCharsets.UTF_8));
  }

  /** Phase 2 of import: re-validates the same pack text and applies it with the explicit mode. */
  @PostMapping("/import/apply")
  public ImportApplyResponseDto applyImport(@RequestBody ImportApplyRequestDto body) {
    ClassificationRuleService.ImportResult result = ruleService.applyImport(
        body.packJson() == null ? null : body.packJson().getBytes(StandardCharsets.UTF_8),
        parseEnum(ImportMode.class, body.mode(), "IMPORT_MODE_INVALID"),
        parseEnum(ConflictResolution.class, body.conflictResolution(), "IMPORT_CONFLICT_RESOLUTION_INVALID"),
        body.expectedRevision(),
        Boolean.TRUE.equals(body.confirmReplaceAll()));
    return new ImportApplyResponseDto(toDto(result.state()), result.added(), result.replaced(), result.unchanged(),
        result.keptExisting(), result.removed());
  }

  private static <E extends Enum<E>> E parseEnum(Class<E> type, String value, String reason) {
    if (value == null || value.isBlank()) {
      return null;
    }
    try {
      return Enum.valueOf(type, value.trim().toUpperCase(Locale.ROOT));
    } catch (IllegalArgumentException e) {
      throw ClassificationRulesException.badRequest(reason, "Unsupported value");
    }
  }

  private ClassificationRulesStateDto toDto(ClassificationRuleService.State state) {
    List<ClassificationRule> rules = state.document().rules();
    List<String> tags = rules.stream().flatMap(r -> r.tags().stream()).distinct().sorted().toList();
    return new ClassificationRulesStateDto(state.document().revisionOrZero(), state.document().updatedAt(),
        state.status().name(), state.statusMessage(), state.storageFile(), rules, tags, ClassificationLimits.asMap(),
        FieldRef.canonicalOptions(), engine.stats());
  }

  private static String truncate(String value, int max) {
    return value == null || value.length() <= max ? value : value.substring(0, max);
  }
}
