package com.logexplorer.core.classify;

import com.fasterxml.jackson.core.JsonPointer;
import com.google.re2j.Pattern;
import com.google.re2j.PatternSyntaxException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Validates a rule and compiles it into a {@link CompiledRule}. The single
 * gatekeeper for rules entering the system — used by save, import, rule
 * test, and configuration load alike — so an active rule has always been
 * validated and every expression has always compiled.
 *
 * <p><b>Regex safety.</b> Expressions are compiled with RE2/J, which
 * guarantees linear-time matching (no catastrophic backtracking). Features
 * RE2 does not support (lookaround, backreferences, possessive/atomic
 * groups) are rejected with an explicit message — never silently executed
 * with {@code java.util.regex} instead.
 */
@org.springframework.stereotype.Component
public final class RuleCompiler {

  private static final java.util.regex.Pattern ID = java.util.regex.Pattern.compile("^[a-z0-9][a-z0-9-]{0,63}$");
  private static final java.util.regex.Pattern TAG = java.util.regex.Pattern.compile("^[a-z0-9][a-z0-9._-]{0,39}$");
  private static final java.util.regex.Pattern EXTRACTION_NAME =
      java.util.regex.Pattern.compile("^[A-Za-z][A-Za-z0-9_]{0,39}$");
  private static final java.util.regex.Pattern GROUP_INDEX = java.util.regex.Pattern.compile("^[0-9]{1,3}$");

  public CompiledRule compile(ClassificationRule input) {
    if (input == null) {
      throw new RuleValidationException(List.of(new RuleValidationError("", "A rule is required")));
    }
    ClassificationRule rule = input.normalized();
    List<RuleValidationError> errors = new ArrayList<>();

    if (rule.id() != null && !ID.matcher(rule.id()).matches()) {
      errors.add(new RuleValidationError("id",
          "Use 1-64 lowercase letters, digits, or hyphens, starting with a letter or digit"));
    }
    if (rule.name() == null || rule.name().isEmpty()) {
      errors.add(new RuleValidationError("name", "A rule name is required"));
    } else if (rule.name().length() > ClassificationLimits.MAX_NAME_LENGTH) {
      errors.add(new RuleValidationError("name", "Use at most " + ClassificationLimits.MAX_NAME_LENGTH + " characters"));
    }
    if (rule.description().length() > ClassificationLimits.MAX_DESCRIPTION_LENGTH) {
      errors.add(new RuleValidationError("description",
          "Use at most " + ClassificationLimits.MAX_DESCRIPTION_LENGTH + " characters"));
    }
    validateTags(rule, errors);
    if (rule.priority() < 0 || rule.priority() > ClassificationLimits.MAX_PRIORITY) {
      errors.add(new RuleValidationError("priority", "Use a priority from 0 to " + ClassificationLimits.MAX_PRIORITY));
    }

    List<CompiledCondition> conditions = compileConditions(rule.conditions(), errors);
    List<CompiledRule.Extraction> extractions = compileExtractions(rule.extractions(), errors);

    if (!errors.isEmpty()) {
      throw new RuleValidationException(errors);
    }
    return new CompiledRule(rule, conditions, extractions);
  }

  /** Compiles one condition on its own — used by pattern detection to evaluate candidate suggestions. */
  public CompiledCondition compileCondition(RuleCondition condition) {
    List<RuleValidationError> errors = new ArrayList<>();
    CompiledCondition compiled = compileCondition(condition == null ? null : condition.normalized(), "condition", errors);
    if (!errors.isEmpty()) {
      throw new RuleValidationException(errors);
    }
    return compiled;
  }

  /** Compiles one extraction on its own — used by pattern detection to measure suggested extraction coverage. */
  public CompiledRule.Extraction compileExtraction(ExtractionDefinition definition) {
    List<RuleValidationError> errors = new ArrayList<>();
    CompiledRule.Extraction compiled =
        compileExtraction(definition == null ? null : definition.normalized(), "extraction", errors, new HashSet<>());
    if (!errors.isEmpty()) {
      throw new RuleValidationException(errors);
    }
    return compiled;
  }

  private void validateTags(ClassificationRule rule, List<RuleValidationError> errors) {
    if (rule.tags().isEmpty()) {
      errors.add(new RuleValidationError("tags", "At least one tag is required"));
      return;
    }
    if (rule.tags().size() > ClassificationLimits.MAX_TAGS_PER_RULE) {
      errors.add(new RuleValidationError("tags", "Use at most " + ClassificationLimits.MAX_TAGS_PER_RULE + " tags"));
    }
    for (int i = 0; i < rule.tags().size(); i++) {
      if (!TAG.matcher(rule.tags().get(i)).matches()) {
        errors.add(new RuleValidationError("tags[" + i + "]",
            "Tags use 1-40 lowercase letters, digits, dots, underscores, or hyphens, starting with a letter or digit"));
      }
    }
  }

  private List<CompiledCondition> compileConditions(List<RuleCondition> conditions, List<RuleValidationError> errors) {
    List<CompiledCondition> compiled = new ArrayList<>();
    if (conditions.isEmpty()) {
      errors.add(new RuleValidationError("conditions", "At least one condition is required"));
      return compiled;
    }
    if (conditions.size() > ClassificationLimits.MAX_CONDITIONS_PER_RULE) {
      errors.add(new RuleValidationError("conditions",
          "Use at most " + ClassificationLimits.MAX_CONDITIONS_PER_RULE + " conditions"));
      return compiled;
    }
    for (int i = 0; i < conditions.size(); i++) {
      CompiledCondition condition = compileCondition(conditions.get(i), "conditions[" + i + "]", errors);
      if (condition != null) {
        compiled.add(condition);
      }
    }
    return compiled;
  }

  private CompiledCondition compileCondition(RuleCondition condition, String path, List<RuleValidationError> errors) {
    if (condition == null) {
      errors.add(new RuleValidationError(path, "A condition is required"));
      return null;
    }
    int before = errors.size();
    FieldRef field = parseField(condition.field(), path + ".field", errors);
    if (condition.matcher() == null) {
      errors.add(new RuleValidationError(path + ".matcher", "Choose a matcher: EXACT, CONTAINS, STARTS_WITH, or REGEX"));
    }
    String value = condition.value();
    Pattern pattern = null;
    if (value == null || value.isEmpty()) {
      errors.add(new RuleValidationError(path + ".value", "A value is required"));
    } else if (condition.matcher() == MatcherType.REGEX) {
      pattern = compileRegex(value, Boolean.TRUE.equals(condition.ignoreCase()), path + ".value", errors);
    } else if (value.length() > ClassificationLimits.MAX_CONDITION_VALUE_LENGTH) {
      errors.add(new RuleValidationError(path + ".value",
          "Use at most " + ClassificationLimits.MAX_CONDITION_VALUE_LENGTH + " characters"));
    }
    if (errors.size() != before) {
      return null;
    }
    return new CompiledCondition(field, condition.matcher(), value, Boolean.TRUE.equals(condition.ignoreCase()), pattern);
  }

  private List<CompiledRule.Extraction> compileExtractions(List<ExtractionDefinition> extractions,
      List<RuleValidationError> errors) {
    List<CompiledRule.Extraction> compiled = new ArrayList<>();
    if (extractions.size() > ClassificationLimits.MAX_EXTRACTIONS_PER_RULE) {
      errors.add(new RuleValidationError("extractions",
          "Use at most " + ClassificationLimits.MAX_EXTRACTIONS_PER_RULE + " extractions"));
      return compiled;
    }
    Set<String> names = new HashSet<>();
    for (int i = 0; i < extractions.size(); i++) {
      CompiledRule.Extraction extraction = compileExtraction(extractions.get(i), "extractions[" + i + "]", errors, names);
      if (extraction != null) {
        compiled.add(extraction);
      }
    }
    return compiled;
  }

  private CompiledRule.Extraction compileExtraction(ExtractionDefinition definition, String path,
      List<RuleValidationError> errors, Set<String> names) {
    if (definition == null) {
      errors.add(new RuleValidationError(path, "An extraction is required"));
      return null;
    }
    int before = errors.size();
    if (definition.name() == null || !EXTRACTION_NAME.matcher(definition.name()).matches()) {
      errors.add(new RuleValidationError(path + ".name",
          "Use 1-40 letters, digits, or underscores, starting with a letter"));
    } else if (!names.add(definition.name())) {
      errors.add(new RuleValidationError(path + ".name", "Extraction names must be unique within a rule"));
    }
    if (definition.label() != null && definition.label().length() > ClassificationLimits.MAX_LABEL_LENGTH) {
      errors.add(new RuleValidationError(path + ".label", "Use at most " + ClassificationLimits.MAX_LABEL_LENGTH + " characters"));
    }
    FieldRef source = parseField(definition.sourceField(), path + ".sourceField", errors);
    String expression = definition.expression();
    Pattern pattern = null;
    int groupIndex = 0;
    JsonPointer pointer = null;
    if (definition.type() == null) {
      errors.add(new RuleValidationError(path + ".type", "Choose an extraction type: REGEX or JSON_POINTER"));
    } else if (expression == null || expression.isEmpty()) {
      errors.add(new RuleValidationError(path + ".expression", "An expression is required"));
    } else if (definition.type() == ExtractionType.REGEX) {
      pattern = compileRegex(expression, false, path + ".expression", errors);
      if (pattern != null) {
        groupIndex = resolveGroup(pattern, definition, path, errors);
      }
    } else {
      if (!expression.startsWith("/") || expression.length() > ClassificationLimits.MAX_PATTERN_LENGTH) {
        errors.add(new RuleValidationError(path + ".expression",
            "A JSON Pointer starts with / (for example /response/status)"));
      } else {
        try {
          pointer = JsonPointer.compile(expression);
        } catch (IllegalArgumentException e) {
          errors.add(new RuleValidationError(path + ".expression", "The JSON Pointer is not valid"));
        }
      }
    }
    if (errors.size() != before) {
      return null;
    }
    return new CompiledRule.Extraction(definition, source, pattern, groupIndex, pointer);
  }

  private int resolveGroup(Pattern pattern, ExtractionDefinition definition, String path, List<RuleValidationError> errors) {
    int groupCount = pattern.groupCount();
    if (groupCount == 0) {
      errors.add(new RuleValidationError(path + ".expression",
          "The expression needs a capture group, for example responseCode=(?P<responseCode>\\d+)"));
      return 0;
    }
    Map<String, Integer> named = pattern.namedGroups();
    String group = definition.group();
    if (group == null) {
      if (named.containsKey(definition.name())) {
        return named.get(definition.name());
      }
      if (groupCount == 1) {
        return 1;
      }
      errors.add(new RuleValidationError(path + ".group",
          "The expression has several groups; name the group to extract"));
      return 0;
    }
    if (GROUP_INDEX.matcher(group).matches()) {
      int index = Integer.parseInt(group);
      if (index < 1 || index > groupCount) {
        errors.add(new RuleValidationError(path + ".group", "Group index must be between 1 and " + groupCount));
        return 0;
      }
      return index;
    }
    Integer index = named.get(group);
    if (index == null) {
      errors.add(new RuleValidationError(path + ".group", "The expression has no group with that name"));
      return 0;
    }
    return index;
  }

  private Pattern compileRegex(String expression, boolean ignoreCase, String path, List<RuleValidationError> errors) {
    if (expression.length() > ClassificationLimits.MAX_PATTERN_LENGTH) {
      errors.add(new RuleValidationError(path, "Use at most " + ClassificationLimits.MAX_PATTERN_LENGTH + " characters"));
      return null;
    }
    try {
      return Pattern.compile(expression, ignoreCase ? Pattern.CASE_INSENSITIVE : 0);
    } catch (PatternSyntaxException e) {
      errors.add(new RuleValidationError(path, regexErrorMessage(e)));
      return null;
    } catch (RuntimeException e) {
      errors.add(new RuleValidationError(path, "The regular expression could not be compiled"));
      return null;
    }
  }

  static String regexErrorMessage(PatternSyntaxException e) {
    String description = e.getDescription() == null ? "invalid syntax" : e.getDescription();
    String hint = "";
    if (description.contains("named capture") || description.contains("escape") || description.contains("repetition")) {
      hint = " (the linear-time RE2 engine does not support lookaround, backreferences, or possessive quantifiers)";
    }
    return "Invalid or unsupported regular expression: " + description + hint;
  }

  private FieldRef parseField(String raw, String path, List<RuleValidationError> errors) {
    try {
      return FieldRef.parse(raw);
    } catch (IllegalArgumentException e) {
      errors.add(new RuleValidationError(path, e.getMessage()));
      return null;
    }
  }
}
