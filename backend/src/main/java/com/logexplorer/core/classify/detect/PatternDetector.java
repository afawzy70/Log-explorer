package com.logexplorer.core.classify.detect;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.re2j.Matcher;
import com.google.re2j.Pattern;
import com.logexplorer.core.classify.ClassificationLimits;
import com.logexplorer.core.classify.CompiledCondition;
import com.logexplorer.core.classify.CompiledRule;
import com.logexplorer.core.classify.ExtractedValueType;
import com.logexplorer.core.classify.ExtractionDefinition;
import com.logexplorer.core.classify.ExtractionType;
import com.logexplorer.core.classify.MatchMode;
import com.logexplorer.core.classify.MatcherType;
import com.logexplorer.core.classify.RuleCompiler;
import com.logexplorer.core.classify.RuleCondition;
import com.logexplorer.core.classify.RuleValidationException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * Local, deterministic structural pattern detection — no external service,
 * no model, no randomness. The same input always yields the same output.
 *
 * <p><b>Algorithm (text values).</b>
 * <ol>
 *   <li>Tokenize the selected value (the <i>anchor</i>) and every sampled value ({@link Tokenizer}).
 *   <li>A sampled value is <i>similar</i> when the longest common subsequence of fixed-text tokens covers at least
 *       {@value #SIMILARITY_THRESHOLD} of the longer token list. Similarity is always measured against the anchor —
 *       never by searching for an arbitrary phrase common to the sample.
 *   <li>An anchor fixed-text token is <i>stable</i> when it aligns in at least {@value #STABLE_THRESHOLD} of the
 *       similar values; everything else (variable shapes and unstable words) is <i>variable</i>.
 *   <li>Candidate matchers are tried from least to most complex — EXACT, STARTS_WITH, STARTS_WITH plus CONTAINS
 *       labels, CONTAINS the longest stable segment (plus labels), then REGEX — each evaluated on the sample. The
 *       first that matches the anchor and at least {@value #MIN_MATCHER_COVERAGE} of similar values without matching
 *       any non-similar value is suggested. REGEX is never suggested merely because it exists.
 *   <li>Extractions are suggested for labelled values and for URLs/paths that follow a stable word, only when they
 *       extract a value from at least {@value #MIN_EXTRACTION_COVERAGE} of similar values.
 * </ol>
 * Fewer than {@value #MIN_SIMILAR_EVENTS} similar values, too little stable text, or no adequate matcher yields
 * {@code NO_SAFE_PATTERN_SUGGESTION} — detection never generalizes from a single event.
 *
 * <p>JSON object values use the same approach over top-level keys.
 *
 * <p>Inputs are expected to be already redacted by the caller; redaction markers are always variable, so a
 * suggestion never carries a redacted literal.
 */
@Component
public class PatternDetector {

  public static final int MIN_SIMILAR_EVENTS = 3;
  static final double SIMILARITY_THRESHOLD = 0.6;
  static final double STABLE_THRESHOLD = 0.9;
  static final double MIN_MATCHER_COVERAGE = 0.9;
  static final double MIN_EXTRACTION_COVERAGE = 0.8;
  static final int MIN_STABLE_CHARS = 6;
  static final int MIN_PREFIX_CHARS = 8;
  static final int MAX_TOKENS = 120;
  static final int MAX_SUGGESTED_EXTRACTIONS = 8;
  static final int MAX_LABEL_CONDITIONS = 4;
  static final int MAX_EXAMPLE_CHARS = 80;

  private final RuleCompiler compiler;
  private final ObjectMapper objectMapper;

  public PatternDetector(RuleCompiler compiler, ObjectMapper objectMapper) {
    this.compiler = compiler;
    this.objectMapper = objectMapper;
  }

  private record Candidate(MatchMode mode, List<RuleCondition> conditions, String display) {
  }

  private record Evaluation(Candidate candidate, boolean anchorMatches, int matchedSimilar, int matchedOther) {
  }

  /**
   * @param field the field reference the values were read from
   * @param anchorValue the selected event's (redacted) value for {@code field}
   * @param sampleValues (redacted) values of {@code field} from the sampled events that have it
   * @param sampledEvents the number of events actually sampled
   */
  public DetectionResult detect(String field, String anchorValue, List<String> sampleValues, int sampledEvents) {
    List<String> values = sampleValues == null ? List.of() : sampleValues.stream().map(PatternDetector::bounded).toList();
    if (anchorValue == null || anchorValue.isBlank()) {
      return DetectionResult.noSuggestion("The selected event has no value for this field.", field, "TEXT",
          sampledEvents, values.size(), 0, List.of());
    }
    String anchor = bounded(anchorValue);
    JsonNode anchorJson = parseObject(anchor);
    if (anchorJson != null) {
      return detectJson(field, anchor, anchorJson, values, sampledEvents);
    }
    return detectText(field, anchor, values, sampledEvents);
  }

  // ------------------------------------------------------------------ text

  private DetectionResult detectText(String field, String anchor, List<String> values, int sampledEvents) {
    List<Tokenizer.Token> tokens = Tokenizer.tokenize(anchor, MAX_TOKENS);
    List<Integer> literalIndexes = new ArrayList<>();
    for (int i = 0; i < tokens.size(); i++) {
      if (tokens.get(i).literal()) {
        literalIndexes.add(i);
      }
    }
    if (literalIndexes.size() < 2) {
      return DetectionResult.noSuggestion("The selected value has too little fixed text to generalize safely.", field,
          "TEXT", sampledEvents, values.size(), 0, List.of());
    }
    List<String> anchorLiterals = literalIndexes.stream().map(i -> tokens.get(i).text()).toList();

    List<String> similar = new ArrayList<>();
    List<String> other = new ArrayList<>();
    int[] alignedCounts = new int[anchorLiterals.size()];
    for (String value : values) {
      List<String> literals = Tokenizer.tokenize(value, MAX_TOKENS).stream()
          .filter(Tokenizer.Token::literal).map(Tokenizer.Token::text).toList();
      boolean[] aligned = new boolean[anchorLiterals.size()];
      int common = lcs(anchorLiterals, literals, aligned);
      double similarity = (double) common / Math.max(anchorLiterals.size(), literals.size());
      if (similarity >= SIMILARITY_THRESHOLD) {
        similar.add(value);
        for (int i = 0; i < aligned.length; i++) {
          if (aligned[i]) {
            alignedCounts[i]++;
          }
        }
      } else {
        other.add(value);
      }
    }
    if (similar.size() < MIN_SIMILAR_EVENTS) {
      return DetectionResult.noSuggestion("Only " + similar.size() + " similar value(s) were found among "
          + values.size() + " sampled value(s); at least " + MIN_SIMILAR_EVENTS + " are needed to suggest a pattern "
          + "safely. Widen the time range or create the rule manually.", field, "TEXT", sampledEvents, values.size(),
          similar.size(), List.of());
    }

    int stableMinimum = Math.max(2, (int) Math.ceil(STABLE_THRESHOLD * similar.size()));
    boolean[] stable = new boolean[tokens.size()];
    int stableChars = 0;
    for (int k = 0; k < literalIndexes.size(); k++) {
      if (alignedCounts[k] >= stableMinimum) {
        stable[literalIndexes.get(k)] = true;
        stableChars += tokens.get(literalIndexes.get(k)).text().length();
      }
    }
    if (stableChars < MIN_STABLE_CHARS) {
      return DetectionResult.noSuggestion("The similar values share too little fixed text to suggest a pattern safely.",
          field, "TEXT", sampledEvents, values.size(), similar.size(), List.of());
    }

    List<int[]> runs = stableRuns(tokens, stable);
    List<String> stableSegments = runs.stream().map(r -> anchor.substring(tokens.get(r[0]).start(), tokens.get(r[1]).end())).toList();
    List<DetectionResult.VariableSegment> variableSegments = variableSegments(tokens, stable);

    List<Candidate> candidates = textCandidates(field, anchor, tokens, stable, runs, similar);
    Evaluation chosen = choose(candidates, anchor, similar, other);
    List<String> warnings = new ArrayList<>();
    if (chosen == null) {
      return DetectionResult.noSuggestion("No simple matcher describes the similar values well enough. Create the rule "
          + "manually or use Advanced mode.", field, "TEXT", sampledEvents, values.size(), similar.size(), List.of());
    }
    addCoverageWarnings(chosen, similar.size(), warnings);
    List<DetectionResult.SuggestedExtraction> extractions = textExtractions(field, tokens, stable, similar);
    return new DetectionResult(DetectionResult.Status.SUGGESTED, null, field, "TEXT", sampledEvents, values.size(),
        similar.size(), stableSegments, variableSegments, chosen.candidate().mode(), chosen.candidate().conditions(),
        chosen.candidate().display(),
        new DetectionResult.Coverage(chosen.matchedSimilar(), similar.size(), chosen.matchedOther(), other.size()),
        extractions, warnings);
  }

  private static List<int[]> stableRuns(List<Tokenizer.Token> tokens, boolean[] stable) {
    List<int[]> runs = new ArrayList<>();
    int runStart = -1;
    for (int i = 0; i < tokens.size(); i++) {
      if (stable[i]) {
        if (runStart < 0) {
          runStart = i;
        }
      } else if (runStart >= 0) {
        runs.add(new int[] {runStart, i - 1});
        runStart = -1;
      }
    }
    if (runStart >= 0) {
      runs.add(new int[] {runStart, tokens.size() - 1});
    }
    return runs;
  }

  private static List<DetectionResult.VariableSegment> variableSegments(List<Tokenizer.Token> tokens, boolean[] stable) {
    List<DetectionResult.VariableSegment> segments = new ArrayList<>();
    Set<String> names = new HashSet<>();
    for (int i = 0; i < tokens.size(); i++) {
      Tokenizer.Token token = tokens.get(i);
      if (stable[i]) {
        continue;
      }
      String base = token.label() != null ? outputName(token.label())
          : token.kind() == Tokenizer.Kind.PATH || token.kind() == Tokenizer.Kind.URL ? "url"
          : token.literal() ? "text" : token.kind().name().toLowerCase(Locale.ROOT);
      String kind = token.literal() ? "TEXT" : token.kind().name();
      segments.add(new DetectionResult.VariableSegment(unique(base, names), kind, example(token.text())));
    }
    return segments;
  }

  private List<Candidate> textCandidates(String field, String anchor, List<Tokenizer.Token> tokens, boolean[] stable,
      List<int[]> runs, List<String> similar) {
    List<Candidate> candidates = new ArrayList<>();
    if (similar.stream().allMatch(anchor::equals)) {
      candidates.add(new Candidate(MatchMode.ALL, List.of(condition(field, MatcherType.EXACT, anchor)),
          field + " equals \"" + anchor + "\""));
    }
    List<String> stableLabels = new ArrayList<>();
    for (int i = 0; i < tokens.size(); i++) {
      if (stable[i] && tokens.get(i).kind() == Tokenizer.Kind.LABEL) {
        stableLabels.add(tokens.get(i).text());
      }
    }
    if (!runs.isEmpty() && runs.get(0)[0] == 0) {
      String prefix = anchor.substring(0, tokens.get(runs.get(0)[1]).end());
      if (prefix.length() >= MIN_PREFIX_CHARS) {
        candidates.add(new Candidate(MatchMode.ALL, List.of(condition(field, MatcherType.STARTS_WITH, prefix)),
            field + " starts with \"" + prefix + "\""));
        List<RuleCondition> withLabels = new ArrayList<>();
        withLabels.add(condition(field, MatcherType.STARTS_WITH, prefix));
        labelsOutside(stableLabels, prefix).forEach(label -> withLabels.add(condition(field, MatcherType.CONTAINS, label)));
        if (withLabels.size() > 1) {
          candidates.add(new Candidate(MatchMode.ALL, withLabels, describe(withLabels)));
        }
      }
    }
    int[] longest = runs.stream()
        .max((a, b) -> Integer.compare(tokens.get(a[1]).end() - tokens.get(a[0]).start(),
            tokens.get(b[1]).end() - tokens.get(b[0]).start()))
        .orElse(null);
    if (longest != null) {
      String segment = anchor.substring(tokens.get(longest[0]).start(), tokens.get(longest[1]).end());
      if (segment.length() >= MIN_STABLE_CHARS) {
        List<RuleCondition> contains = new ArrayList<>();
        contains.add(condition(field, MatcherType.CONTAINS, segment));
        labelsOutside(stableLabels, segment).forEach(label -> contains.add(condition(field, MatcherType.CONTAINS, label)));
        candidates.add(new Candidate(MatchMode.ALL, contains, describe(contains)));
      }
    }
    String regex = buildRegex(tokens, stable);
    if (regex != null) {
      candidates.add(new Candidate(MatchMode.ALL, List.of(condition(field, MatcherType.REGEX, regex)),
          field + " matches /" + regex + "/"));
    }
    return candidates;
  }

  private static List<String> labelsOutside(List<String> labels, String covered) {
    return labels.stream().filter(label -> !covered.contains(label)).distinct().limit(MAX_LABEL_CONDITIONS).toList();
  }

  private static String buildRegex(List<Tokenizer.Token> tokens, boolean[] stable) {
    StringBuilder regex = new StringBuilder();
    int previousEnd = -1;
    for (int i = 0; i < tokens.size(); i++) {
      Tokenizer.Token token = tokens.get(i);
      if (previousEnd < 0) {
        if (stable[i]) {
          regex.append('^');
        }
      } else if (token.start() > previousEnd) {
        regex.append("\\s+");
      }
      regex.append(stable[i] ? Pattern.quote(token.text()) : variableRegex(token));
      previousEnd = token.end();
    }
    return regex.length() > ClassificationLimits.MAX_PATTERN_LENGTH ? null : regex.toString();
  }

  private static String variableRegex(Tokenizer.Token token) {
    return switch (token.kind()) {
      case NUMBER -> "[-+]?\\d+(?:\\.\\d+)?\\S*";
      case DURATION -> "\\d+(?:\\.\\d+)?[a-zµ]+\\S*";
      case UUID -> "[0-9a-fA-F-]{36}\\S*";
      default -> "\\S+";
    };
  }

  private List<DetectionResult.SuggestedExtraction> textExtractions(String field, List<Tokenizer.Token> tokens,
      boolean[] stable, List<String> similar) {
    List<DetectionResult.SuggestedExtraction> suggestions = new ArrayList<>();
    Set<String> names = new HashSet<>();
    for (int i = 1; i < tokens.size() && suggestions.size() < MAX_SUGGESTED_EXTRACTIONS; i++) {
      Tokenizer.Token token = tokens.get(i);
      Tokenizer.Token previous = tokens.get(i - 1);
      if (stable[i] || !stable[i - 1]) {
        continue;
      }
      String name;
      String expression;
      ExtractedValueType type = ExtractedValueType.STRING;
      String quotedPrevious = Pattern.quote(previous.text());
      if (token.label() != null && previous.kind() == Tokenizer.Kind.LABEL) {
        String separator = previous.end() == token.start() ? "" : "\\s*";
        String base = outputName(token.label());
        String core = token.text().replaceAll("[,;.)\\]}]+$", "");
        switch (token.kind()) {
          case NUMBER -> {
            boolean integer = core.matches("[-+]?\\d+");
            type = integer ? ExtractedValueType.INTEGER : ExtractedValueType.DECIMAL;
            name = unique(base, names);
            expression = quotedPrevious + separator + "(?P<" + name + ">" + (integer ? "[-+]?\\d+" : "[-+]?\\d+(?:\\.\\d+)?") + ")";
          }
          case DURATION -> {
            String unit = core.replaceAll("^[0-9.]+", "");
            boolean integer = core.substring(0, core.length() - unit.length()).matches("\\d+");
            type = integer ? ExtractedValueType.INTEGER : ExtractedValueType.DECIMAL;
            name = unique(base + capitalize(unit), names);
            expression = quotedPrevious + separator + "(?P<" + name + ">\\d+(?:\\.\\d+)?)" + Pattern.quote(unit);
          }
          default -> {
            name = unique(base, names);
            expression = quotedPrevious + separator + "(?P<" + name + ">[^\\s,;]+)";
          }
        }
      } else if ((token.kind() == Tokenizer.Kind.PATH || token.kind() == Tokenizer.Kind.URL)
          && previous.kind() == Tokenizer.Kind.WORD) {
        name = unique("url", names);
        expression = "\\b" + quotedPrevious + "\\s+(?P<" + name + ">\\S+)";
      } else {
        continue;
      }
      ExtractionDefinition definition = new ExtractionDefinition(name, humanize(name), field, ExtractionType.REGEX,
          expression, name, type, false);
      CompiledRule.Extraction compiled;
      try {
        compiled = compiler.compileExtraction(definition);
      } catch (RuleValidationException e) {
        names.remove(name);
        continue;
      }
      int extracted = 0;
      for (String value : similar) {
        Matcher matcher = compiled.pattern().matcher(value);
        if (matcher.find() && matcher.group(compiled.groupIndex()) != null) {
          extracted++;
        }
      }
      if (extracted >= Math.ceil(MIN_EXTRACTION_COVERAGE * similar.size())) {
        suggestions.add(new DetectionResult.SuggestedExtraction(definition, extracted, similar.size()));
      } else {
        names.remove(name);
      }
    }
    return suggestions;
  }

  // ------------------------------------------------------------------ JSON

  private DetectionResult detectJson(String field, String anchor, JsonNode anchorJson, List<String> values,
      int sampledEvents) {
    List<String> anchorKeys = new ArrayList<>();
    anchorJson.fieldNames().forEachRemaining(anchorKeys::add);
    if (anchorKeys.size() < 2) {
      return DetectionResult.noSuggestion("The selected JSON value has too few properties to generalize safely.", field,
          "JSON", sampledEvents, values.size(), 0, List.of());
    }
    Set<String> anchorKeySet = new LinkedHashSet<>(anchorKeys);
    List<String> similar = new ArrayList<>();
    List<JsonNode> similarJson = new ArrayList<>();
    List<String> other = new ArrayList<>();
    for (String value : values) {
      JsonNode node = parseObject(value);
      if (node == null) {
        other.add(value);
        continue;
      }
      Set<String> keys = new LinkedHashSet<>();
      node.fieldNames().forEachRemaining(keys::add);
      Set<String> intersection = new HashSet<>(keys);
      intersection.retainAll(anchorKeySet);
      Set<String> union = new HashSet<>(keys);
      union.addAll(anchorKeySet);
      if ((double) intersection.size() / union.size() >= SIMILARITY_THRESHOLD) {
        similar.add(value);
        similarJson.add(node);
      } else {
        other.add(value);
      }
    }
    if (similar.size() < MIN_SIMILAR_EVENTS) {
      return DetectionResult.noSuggestion("Only " + similar.size() + " similar JSON value(s) were found among "
          + values.size() + " sampled value(s); at least " + MIN_SIMILAR_EVENTS + " are needed.", field, "JSON",
          sampledEvents, values.size(), similar.size(), List.of());
    }
    int stableMinimum = Math.max(2, (int) Math.ceil(STABLE_THRESHOLD * similar.size()));
    List<String> stableKeys = new ArrayList<>();
    List<DetectionResult.VariableSegment> variables = new ArrayList<>();
    for (String key : anchorKeys) {
      long present = similarJson.stream().filter(n -> n.has(key)).count();
      if (present >= stableMinimum) {
        stableKeys.add(key);
        long distinct = similarJson.stream().filter(n -> n.has(key)).map(n -> n.get(key).toString()).distinct().count();
        if (distinct > 1) {
          variables.add(new DetectionResult.VariableSegment(key, "JSON_VALUE", example(anchorJson.get(key).toString())));
        }
      }
    }
    if (stableKeys.size() < 2) {
      return DetectionResult.noSuggestion("The similar JSON values share too few properties to suggest a pattern safely.",
          field, "JSON", sampledEvents, values.size(), similar.size(), List.of());
    }
    List<Candidate> candidates = new ArrayList<>();
    for (int count = 2; count <= Math.min(5, stableKeys.size()); count++) {
      List<RuleCondition> conditions = stableKeys.subList(0, count).stream()
          .map(key -> condition(field, MatcherType.CONTAINS, "\"" + key + "\"")).toList();
      candidates.add(new Candidate(MatchMode.ALL, conditions, describe(conditions)));
    }
    Evaluation chosen = choose(candidates, anchor, similar, other);
    if (chosen == null) {
      return DetectionResult.noSuggestion("No simple matcher describes the similar JSON values well enough.", field,
          "JSON", sampledEvents, values.size(), similar.size(), List.of());
    }
    List<String> warnings = new ArrayList<>();
    addCoverageWarnings(chosen, similar.size(), warnings);
    List<DetectionResult.SuggestedExtraction> extractions = new ArrayList<>();
    Set<String> names = new HashSet<>();
    for (String key : stableKeys) {
      if (extractions.size() >= MAX_SUGGESTED_EXTRACTIONS) {
        break;
      }
      JsonNode sample = anchorJson.get(key);
      ExtractedValueType type = sample.isIntegralNumber() ? ExtractedValueType.INTEGER
          : sample.isNumber() ? ExtractedValueType.DECIMAL
          : sample.isBoolean() ? ExtractedValueType.BOOLEAN
          : ExtractedValueType.STRING;
      String name = unique(outputName(key), names);
      String pointer = "/" + key.replace("~", "~0").replace("/", "~1");
      int extracted = (int) similarJson.stream().filter(n -> n.has(key) && !n.get(key).isNull()).count();
      if (extracted >= Math.ceil(MIN_EXTRACTION_COVERAGE * similar.size())) {
        extractions.add(new DetectionResult.SuggestedExtraction(new ExtractionDefinition(name, humanize(name), field,
            ExtractionType.JSON_POINTER, pointer, null, type, false), extracted, similar.size()));
      } else {
        names.remove(name);
      }
    }
    return new DetectionResult(DetectionResult.Status.SUGGESTED, null, field, "JSON", sampledEvents, values.size(),
        similar.size(), stableKeys.stream().map(k -> "\"" + k + "\"").toList(), variables, chosen.candidate().mode(),
        chosen.candidate().conditions(), chosen.candidate().display(),
        new DetectionResult.Coverage(chosen.matchedSimilar(), similar.size(), chosen.matchedOther(), other.size()),
        extractions, warnings);
  }

  // ------------------------------------------------------------------ shared

  private Evaluation choose(List<Candidate> candidates, String anchor, List<String> similar, List<String> other) {
    List<Evaluation> evaluations = new ArrayList<>();
    for (Candidate candidate : candidates) {
      Evaluation evaluation = evaluate(candidate, anchor, similar, other);
      if (evaluation != null && evaluation.anchorMatches()) {
        evaluations.add(evaluation);
      }
    }
    int required = (int) Math.ceil(MIN_MATCHER_COVERAGE * similar.size());
    for (Evaluation evaluation : evaluations) {
      if (evaluation.matchedSimilar() >= required && evaluation.matchedOther() == 0) {
        return evaluation;
      }
    }
    Evaluation best = null;
    for (Evaluation evaluation : evaluations) {
      if (evaluation.matchedSimilar() >= required && (best == null || evaluation.matchedOther() < best.matchedOther())) {
        best = evaluation;
      }
    }
    return best;
  }

  private Evaluation evaluate(Candidate candidate, String anchor, List<String> similar, List<String> other) {
    List<CompiledCondition> compiled = new ArrayList<>();
    try {
      for (RuleCondition condition : candidate.conditions()) {
        compiled.add(compiler.compileCondition(condition));
      }
    } catch (RuleValidationException e) {
      return null;
    }
    int matchedSimilar = (int) similar.stream().filter(v -> allMatch(compiled, v)).count();
    int matchedOther = (int) other.stream().filter(v -> allMatch(compiled, v)).count();
    return new Evaluation(candidate, allMatch(compiled, anchor), matchedSimilar, matchedOther);
  }

  private static boolean allMatch(List<CompiledCondition> conditions, String value) {
    for (CompiledCondition condition : conditions) {
      if (!condition.test(value)) {
        return false;
      }
    }
    return true;
  }

  private static void addCoverageWarnings(Evaluation chosen, int similar, List<String> warnings) {
    if (chosen.matchedSimilar() < similar) {
      warnings.add("The suggestion matches " + chosen.matchedSimilar() + " of " + similar + " similar values.");
    }
    if (chosen.matchedOther() > 0) {
      warnings.add("The suggestion also matches " + chosen.matchedOther() + " sampled value(s) that were not "
          + "considered similar. Review them for false positives before saving.");
    }
  }

  private static RuleCondition condition(String field, MatcherType matcher, String value) {
    return new RuleCondition(field, matcher, value, false);
  }

  private static String describe(List<RuleCondition> conditions) {
    StringBuilder description = new StringBuilder();
    for (RuleCondition condition : conditions) {
      if (description.length() > 0) {
        description.append(" AND ");
      }
      String verb = switch (condition.matcher()) {
        case EXACT -> "equals";
        case CONTAINS -> "contains";
        case STARTS_WITH -> "starts with";
        case REGEX -> "matches";
      };
      description.append(condition.field()).append(' ').append(verb).append(" \"").append(condition.value()).append('"');
    }
    return description.toString();
  }

  /** Longest common subsequence length; marks which anchor positions take part in one optimal alignment. */
  static int lcs(List<String> anchor, List<String> candidate, boolean[] alignedAnchor) {
    int n = anchor.size();
    int m = candidate.size();
    int[][] table = new int[n + 1][m + 1];
    for (int i = n - 1; i >= 0; i--) {
      for (int j = m - 1; j >= 0; j--) {
        table[i][j] = anchor.get(i).equals(candidate.get(j))
            ? table[i + 1][j + 1] + 1
            : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    int i = 0;
    int j = 0;
    while (i < n && j < m) {
      if (anchor.get(i).equals(candidate.get(j))) {
        alignedAnchor[i] = true;
        i++;
        j++;
      } else if (table[i + 1][j] >= table[i][j + 1]) {
        i++;
      } else {
        j++;
      }
    }
    return table[0][0];
  }

  private JsonNode parseObject(String value) {
    String trimmed = value.trim();
    if (!trimmed.startsWith("{")) {
      return null;
    }
    try {
      JsonNode node = objectMapper.readTree(trimmed);
      return node != null && node.isObject() ? node : null;
    } catch (Exception e) {
      return null;
    }
  }

  private static String bounded(String value) {
    return value.length() > ClassificationLimits.MAX_DETECTION_VALUE_CHARS
        ? value.substring(0, ClassificationLimits.MAX_DETECTION_VALUE_CHARS)
        : value;
  }

  static String outputName(String raw) {
    StringBuilder name = new StringBuilder();
    boolean upperNext = false;
    for (char c : raw.toCharArray()) {
      if (Character.isLetterOrDigit(c) && c < 128) {
        if (name.length() == 0) {
          name.append(Character.isDigit(c) ? "f" + c : Character.toLowerCase(c));
        } else {
          name.append(upperNext ? Character.toUpperCase(c) : c);
        }
        upperNext = false;
      } else {
        upperNext = name.length() > 0;
      }
    }
    String result = name.length() == 0 ? "value" : name.toString();
    return result.length() > ClassificationLimits.MAX_EXTRACTION_NAME_LENGTH - 3
        ? result.substring(0, ClassificationLimits.MAX_EXTRACTION_NAME_LENGTH - 3)
        : result;
  }

  private static final java.util.Map<String, String> ACRONYMS = java.util.Map.of(
      "url", "URL", "uri", "URI", "id", "ID", "ip", "IP", "http", "HTTP", "json", "JSON", "api", "API");

  static String humanize(String name) {
    String spaced = name.replaceAll("([a-z0-9])([A-Z])", "$1 $2").toLowerCase(Locale.ROOT);
    if (spaced.endsWith(" ms")) {
      spaced = spaced.substring(0, spaced.length() - 3) + " (ms)";
    }
    if (spaced.isEmpty()) {
      return name;
    }
    String[] words = spaced.split(" ");
    for (int i = 0; i < words.length; i++) {
      words[i] = ACRONYMS.getOrDefault(words[i], words[i]);
    }
    String joined = String.join(" ", words);
    return Character.toUpperCase(joined.charAt(0)) + joined.substring(1);
  }

  private static String capitalize(String value) {
    return value.isEmpty() ? value : Character.toUpperCase(value.charAt(0)) + value.substring(1);
  }

  private static String unique(String base, Set<String> used) {
    String candidate = base;
    int suffix = 2;
    while (!used.add(candidate)) {
      candidate = base + suffix++;
    }
    return candidate;
  }

  private static String example(String text) {
    return text.length() > MAX_EXAMPLE_CHARS ? text.substring(0, MAX_EXAMPLE_CHARS) + "…" : text;
  }
}
