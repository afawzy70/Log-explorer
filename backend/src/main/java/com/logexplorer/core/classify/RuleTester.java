package com.logexplorer.core.classify;

import com.logexplorer.core.mask.ExtractedValueRedactor;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.ExtractedField;
import com.logexplorer.core.model.RuleMatch;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Component;

/**
 * Tests an unsaved rule against a bounded real sample. Never persists
 * anything and never changes the active rules: the rule is compiled on its
 * own and evaluated directly. Previews are bounded to {@link
 * ClassificationLimits#PREVIEW_COUNT} events and pass the same redaction
 * boundary as normal search results.
 *
 * <p>There is no ground truth here, so the result reports what matched —
 * never a false-positive rate.
 */
@Component
public class RuleTester {

  static final String REVIEW_NOTE = "Review these matches for false positives. Counts describe this bounded sample "
      + "only, not the whole source.";

  private final RuleCompiler compiler;
  private final ClassificationEngine engine;
  private final ExtractedValueRedactor redactor;

  public RuleTester(RuleCompiler compiler, ClassificationEngine engine, ExtractedValueRedactor redactor) {
    this.compiler = compiler;
    this.engine = engine;
    this.redactor = redactor;
  }

  public record RuleTestResult(int sampledEvents, boolean sampleLimitReached, int matched, int notMatched,
      List<ExtractionCoverage> extractionCoverage, List<PreviewEvent> matchedPreview, List<PreviewEvent> nearMissPreview,
      String reviewNote) {
  }

  public record ExtractionCoverage(String name, String label, int extracted, int invalid, int of) {
  }

  public record PreviewEvent(Instant timestamp, String service, String severity, String field, String fieldValue,
      boolean fieldValueTruncated, int conditionsMatched, int conditionsTotal, List<PreviewValue> extracted) {
  }

  public record PreviewValue(String name, String label, String value, String status, boolean redacted,
      boolean truncated) {
  }

  public RuleTestResult test(ClassificationRule rule, List<CanonicalLogEvent> sample, boolean sampleLimitReached) {
    CompiledRule compiled = compiler.compile(rule);
    FieldRef previewField = compiled.conditions().get(0).field();
    int total = compiled.conditions().size();
    boolean allMode = compiled.rule().matchMode() == MatchMode.ALL;

    Map<String, int[]> coverage = new LinkedHashMap<>();
    for (CompiledRule.Extraction extraction : compiled.extractions()) {
      coverage.put(extraction.definition().name(), new int[2]);
    }
    int matched = 0;
    List<PreviewEvent> matchedPreview = new ArrayList<>();
    List<PreviewEvent> nearMiss = new ArrayList<>();
    for (CanonicalLogEvent event : sample) {
      Optional<RuleMatch> match = engine.evaluate(compiled, event);
      if (match.isPresent()) {
        matched++;
        for (ExtractedField field : match.get().extracted()) {
          int[] counts = coverage.get(field.name());
          if (field.status() == ExtractedField.Status.PRESENT) {
            counts[0]++;
          } else if (field.status() == ExtractedField.Status.INVALID) {
            counts[1]++;
          }
        }
        if (matchedPreview.size() < ClassificationLimits.PREVIEW_COUNT) {
          matchedPreview.add(preview(event, previewField, total, total, match.get().extracted()));
        }
      } else if (allMode && total > 1 && nearMiss.size() < ClassificationLimits.PREVIEW_COUNT) {
        int conditionsMatched = engine.conditionsMatched(compiled, event);
        if (conditionsMatched > 0) {
          nearMiss.add(preview(event, previewField, conditionsMatched, total, List.of()));
        }
      }
    }
    int finalMatched = matched;
    List<ExtractionCoverage> extractionCoverage = compiled.extractions().stream()
        .map(x -> new ExtractionCoverage(x.definition().name(), x.definition().label(),
            coverage.get(x.definition().name())[0], coverage.get(x.definition().name())[1], finalMatched))
        .toList();
    return new RuleTestResult(sample.size(), sampleLimitReached, matched, sample.size() - matched, extractionCoverage,
        matchedPreview, nearMiss, REVIEW_NOTE);
  }

  private PreviewEvent preview(CanonicalLogEvent event, FieldRef field, int conditionsMatched, int total,
      List<ExtractedField> extracted) {
    ExtractedValueRedactor.Presented value = redactor.presentText(event, engine.fieldText(field, event),
        ClassificationLimits.MAX_PREVIEW_FIELD_CHARS);
    List<PreviewValue> values = extracted.stream().map(f -> {
      ExtractedValueRedactor.Presented presented =
          redactor.present(event, f, ClassificationLimits.MAX_RETURNED_EXTRACTED_VALUE_LENGTH);
      return new PreviewValue(f.name(), f.label(), presented.value(), f.status().name(), presented.redacted(),
          presented.truncated());
    }).toList();
    return new PreviewEvent(event.timestamp(), event.service(), event.severity(), field.raw(), value.value(),
        value.truncated(), conditionsMatched, total, values);
  }
}
