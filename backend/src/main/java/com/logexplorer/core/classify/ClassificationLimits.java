package com.logexplorer.core.classify;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Documented, bounded defaults for the classification feature (owner
 * mission §"Size / abuse limits"). Every limit is enforced server-side;
 * the UI only mirrors them.
 */
public final class ClassificationLimits {

  public static final int MAX_RULES = 200;
  public static final int MAX_CONDITIONS_PER_RULE = 10;
  public static final int MAX_EXTRACTIONS_PER_RULE = 20;
  public static final int MAX_TAGS_PER_RULE = 5;
  public static final int MAX_PATTERN_LENGTH = 1_000;
  public static final int MAX_CONDITION_VALUE_LENGTH = 1_000;
  public static final int MAX_NAME_LENGTH = 80;
  public static final int MAX_DESCRIPTION_LENGTH = 500;
  public static final int MAX_TAG_LENGTH = 40;
  public static final int MAX_LABEL_LENGTH = 60;
  public static final int MAX_EXTRACTION_NAME_LENGTH = 40;
  public static final int MAX_PRIORITY = 10_000;

  public static final int MAX_IMPORT_BYTES = 262_144;
  public static final int MAX_IMPORT_RULES = MAX_RULES;

  /** Owner-expected pattern-detection / rule-test sample target. */
  public static final int DEFAULT_SAMPLE_SIZE = 200;
  public static final int MAX_SAMPLE_SIZE = 500;
  public static final int PREVIEW_COUNT = 5;

  /** Longest extracted value returned to a browser (after redaction). */
  public static final int MAX_RETURNED_EXTRACTED_VALUE_LENGTH = 2_000;
  /** Longest extracted value kept on an in-memory event before redaction. */
  public static final int MAX_STORED_EXTRACTED_VALUE_LENGTH = 8_000;
  /** Field values longer than this are matched on their first N characters. */
  public static final int MAX_EVALUATED_FIELD_CHARS = 32_768;
  /** JSON Pointer extraction parses at most this many characters of a JSON text. */
  public static final int MAX_JSON_PARSE_CHARS = 65_536;
  /** Pattern detection analyses at most this many characters per value. */
  public static final int MAX_DETECTION_VALUE_CHARS = 4_096;
  /** Field value shown per preview row. */
  public static final int MAX_PREVIEW_FIELD_CHARS = 300;

  private ClassificationLimits() {
  }

  public static Map<String, Integer> asMap() {
    Map<String, Integer> limits = new LinkedHashMap<>();
    limits.put("maxRules", MAX_RULES);
    limits.put("maxConditionsPerRule", MAX_CONDITIONS_PER_RULE);
    limits.put("maxExtractionsPerRule", MAX_EXTRACTIONS_PER_RULE);
    limits.put("maxTagsPerRule", MAX_TAGS_PER_RULE);
    limits.put("maxPatternLength", MAX_PATTERN_LENGTH);
    limits.put("maxConditionValueLength", MAX_CONDITION_VALUE_LENGTH);
    limits.put("maxNameLength", MAX_NAME_LENGTH);
    limits.put("maxDescriptionLength", MAX_DESCRIPTION_LENGTH);
    limits.put("maxTagLength", MAX_TAG_LENGTH);
    limits.put("maxLabelLength", MAX_LABEL_LENGTH);
    limits.put("maxExtractionNameLength", MAX_EXTRACTION_NAME_LENGTH);
    limits.put("maxImportBytes", MAX_IMPORT_BYTES);
    limits.put("maxImportRules", MAX_IMPORT_RULES);
    limits.put("defaultSampleSize", DEFAULT_SAMPLE_SIZE);
    limits.put("maxSampleSize", MAX_SAMPLE_SIZE);
    limits.put("previewCount", PREVIEW_COUNT);
    limits.put("maxReturnedExtractedValueLength", MAX_RETURNED_EXTRACTED_VALUE_LENGTH);
    return limits;
  }
}
