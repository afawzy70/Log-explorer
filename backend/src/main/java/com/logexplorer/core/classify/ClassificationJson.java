package com.logexplorer.core.classify;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;

/**
 * The one JSON configuration used for rules files and packs: strict on
 * input (unknown properties and duplicate keys are errors, so incompatible
 * structures are never silently ignored) and deterministic on output
 * (record component order, ISO-8601 instants, indented).
 */
public final class ClassificationJson {

  private ClassificationJson() {
  }

  public static ObjectMapper strictMapper() {
    return JsonMapper.builder()
        .findAndAddModules()
        .enable(SerializationFeature.INDENT_OUTPUT)
        .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
        .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
        .enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
        .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
        .enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
        .build();
  }
}
