package com.logexplorer.core.classify;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.re2j.Matcher;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.ExtractedField;
import com.logexplorer.core.model.RuleMatch;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.LongAdder;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * The runtime Event Classification &amp; Extraction Engine.
 *
 * <p>Evaluates the active {@link CompiledRuleSet} against each canonical
 * event once, right after parsing and field mapping (see {@code
 * core.parse.LogLineParser}) and before search filtering, masking, and
 * serialization. It is generic: rules are data, never code, and every
 * source's events take this same path.
 *
 * <p><b>Cost.</b> A snapshot read (one volatile read), then for each enabled
 * rule a bounded number of pre-compiled literal/RE2 checks against field
 * values resolved at most once per event. No disk I/O, no JSON rule
 * parsing, no pattern compilation on this path.
 *
 * <p><b>Failure semantics.</b> A rule that throws while evaluating one event
 * is skipped for that event and counted; search keeps working. A failed
 * extraction becomes {@code INVALID} for that one value while the
 * classification itself still applies. Diagnostics carry the rule id and
 * exception type only — never event content.
 */
@Component
public class ClassificationEngine implements EventClassifier {

  private static final Logger log = LoggerFactory.getLogger(ClassificationEngine.class);

  private final ObjectMapper objectMapper;
  private final AtomicReference<CompiledRuleSet> active = new AtomicReference<>(CompiledRuleSet.EMPTY);
  private final AtomicLong generation = new AtomicLong();
  private final LongAdder eventsEvaluated = new LongAdder();
  private final LongAdder ruleMatches = new LongAdder();
  private final LongAdder evaluationFailures = new LongAdder();

  public ClassificationEngine(ObjectMapper objectMapper) {
    this.objectMapper = objectMapper;
  }

  /** Low-cost aggregate counters (no per-rule or per-value labels, so nothing sensitive or high-cardinality). */
  public record RuntimeStats(long eventsEvaluated, long ruleMatches, long evaluationFailures) {
  }

  public void activate(CompiledRuleSet ruleSet) {
    active.set(ruleSet == null ? CompiledRuleSet.EMPTY : ruleSet);
    generation.incrementAndGet();
  }

  public CompiledRuleSet activeRuleSet() {
    return active.get();
  }

  @Override
  public long generation() {
    return generation.get();
  }

  public RuntimeStats stats() {
    return new RuntimeStats(eventsEvaluated.sum(), ruleMatches.sum(), evaluationFailures.sum());
  }

  @Override
  public CanonicalLogEvent classify(CanonicalLogEvent event) {
    CompiledRuleSet ruleSet = active.get();
    if (event == null || ruleSet.rules().isEmpty()) {
      return event;
    }
    eventsEvaluated.increment();
    EvaluationContext context = new EvaluationContext(event);
    List<RuleMatch> matches = null;
    for (CompiledRule rule : ruleSet.rules()) {
      try {
        RuleMatch match = evaluate(rule, context);
        if (match != null) {
          if (matches == null) {
            matches = new ArrayList<>(2);
          }
          matches.add(match);
        }
      } catch (RuntimeException e) {
        evaluationFailures.increment();
        log.debug("Classification rule {} failed to evaluate an event ({})", rule.rule().id(), e.getClass().getSimpleName());
      }
    }
    if (matches == null) {
      return event;
    }
    ruleMatches.add(matches.size());
    return event.toBuilder().classifications(matches).build();
  }

  /** Evaluates one compiled rule regardless of its enabled flag — used by rule testing. */
  public Optional<RuleMatch> evaluate(CompiledRule rule, CanonicalLogEvent event) {
    return Optional.ofNullable(evaluate(rule, new EvaluationContext(event)));
  }

  /** How many of the rule's conditions match — lets rule testing surface near-miss (borderline) events. */
  public int conditionsMatched(CompiledRule rule, CanonicalLogEvent event) {
    EvaluationContext context = new EvaluationContext(event);
    int count = 0;
    for (CompiledCondition condition : rule.conditions()) {
      if (condition.test(context.text(condition.field()))) {
        count++;
      }
    }
    return count;
  }

  /** Text form of a field value, as matched by conditions (structured values become compact JSON). */
  public String fieldText(FieldRef field, CanonicalLogEvent event) {
    return new EvaluationContext(event).text(field);
  }

  private RuleMatch evaluate(CompiledRule rule, EvaluationContext context) {
    if (!matches(rule, context)) {
      return null;
    }
    List<ExtractedField> extracted = new ArrayList<>(rule.extractions().size());
    for (CompiledRule.Extraction extraction : rule.extractions()) {
      extracted.add(extract(extraction, context));
    }
    ClassificationRule definition = rule.rule();
    return new RuleMatch(definition.id(), definition.name(), definition.tags(), extracted);
  }

  private boolean matches(CompiledRule rule, EvaluationContext context) {
    boolean any = rule.rule().matchMode() == MatchMode.ANY;
    for (CompiledCondition condition : rule.conditions()) {
      boolean result = condition.test(context.text(condition.field()));
      if (any && result) {
        return true;
      }
      if (!any && !result) {
        return false;
      }
    }
    return !any;
  }

  private ExtractedField extract(CompiledRule.Extraction extraction, EvaluationContext context) {
    ExtractionDefinition definition = extraction.definition();
    String name = definition.name();
    String label = definition.label();
    boolean sensitive = Boolean.TRUE.equals(definition.sensitive());
    try {
      String raw;
      if (definition.type() == ExtractionType.REGEX) {
        String subject = context.text(extraction.source());
        if (subject == null) {
          return ExtractedField.absent(name, label, sensitive);
        }
        if (subject.length() > ClassificationLimits.MAX_EVALUATED_FIELD_CHARS) {
          subject = subject.substring(0, ClassificationLimits.MAX_EVALUATED_FIELD_CHARS);
        }
        Matcher matcher = extraction.pattern().matcher(subject);
        if (!matcher.find()) {
          return ExtractedField.absent(name, label, sensitive);
        }
        raw = matcher.group(extraction.groupIndex());
      } else {
        JsonNode root = context.json(extraction.source());
        if (root == null) {
          return ExtractedField.absent(name, label, sensitive);
        }
        JsonNode node = root.at(extraction.pointer());
        if (node == null || node.isMissingNode() || node.isNull()) {
          return ExtractedField.absent(name, label, sensitive);
        }
        raw = node.isValueNode() ? node.asText() : objectMapper.writeValueAsString(node);
      }
      if (raw == null) {
        return ExtractedField.absent(name, label, sensitive);
      }
      String converted = convert(raw, definition.valueType());
      if (converted == null) {
        return ExtractedField.invalid(name, label, sensitive);
      }
      if (converted.length() > ClassificationLimits.MAX_STORED_EXTRACTED_VALUE_LENGTH) {
        converted = converted.substring(0, ClassificationLimits.MAX_STORED_EXTRACTED_VALUE_LENGTH);
      }
      return new ExtractedField(name, label, converted, ExtractedField.Status.PRESENT, sensitive);
    } catch (Exception e) {
      evaluationFailures.increment();
      return ExtractedField.invalid(name, label, sensitive);
    }
  }

  static String convert(String raw, ExtractedValueType type) {
    ExtractedValueType effective = type == null ? ExtractedValueType.STRING : type;
    String trimmed = raw.trim();
    try {
      return switch (effective) {
        case STRING -> raw;
        case INTEGER -> new BigInteger(trimmed).toString();
        case DECIMAL -> new BigDecimal(trimmed).toPlainString();
        case BOOLEAN -> {
          String lower = trimmed.toLowerCase(Locale.ROOT);
          yield lower.equals("true") || lower.equals("false") ? lower : null;
        }
      };
    } catch (NumberFormatException e) {
      return null;
    }
  }

  /** Per-event memo: each referenced field is resolved (and, for JSON Pointer, parsed) at most once. */
  private final class EvaluationContext {
    private final CanonicalLogEvent event;
    private final Map<String, String> texts = new HashMap<>(4);
    private final Map<String, Optional<JsonNode>> json = new HashMap<>(2);

    EvaluationContext(CanonicalLogEvent event) {
      this.event = event;
    }

    String text(FieldRef field) {
      return texts.computeIfAbsent(field.raw(), key -> asText(field.resolve(event)));
    }

    JsonNode json(FieldRef field) {
      return json.computeIfAbsent(field.raw(), key -> Optional.ofNullable(asJson(field.resolve(event)))).orElse(null);
    }

    private String asText(Object value) {
      if (value == null) {
        return null;
      }
      if (value instanceof String s) {
        return s;
      }
      if (value instanceof Number || value instanceof Boolean) {
        return value.toString();
      }
      try {
        return objectMapper.writeValueAsString(value);
      } catch (Exception e) {
        return null;
      }
    }

    private JsonNode asJson(Object value) {
      if (value == null) {
        return null;
      }
      if (value instanceof Map<?, ?> || value instanceof List<?>) {
        return objectMapper.valueToTree(value);
      }
      if (value instanceof String s) {
        String trimmed = s.trim();
        if (trimmed.length() > ClassificationLimits.MAX_JSON_PARSE_CHARS
            || !(trimmed.startsWith("{") || trimmed.startsWith("["))) {
          return null;
        }
        try {
          return objectMapper.readTree(trimmed);
        } catch (Exception e) {
          return null; // not JSON - never pretend it is
        }
      }
      return null;
    }
  }
}
