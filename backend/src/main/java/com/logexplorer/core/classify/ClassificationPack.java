package com.logexplorer.core.classify;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * The portable classification rule pack — the only import/export format.
 * Contains rule definitions only: never sampled events, extracted runtime
 * values, credentials, tokens, source connection settings, local paths, or
 * the internal revision/backup data.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ClassificationPack(String format, Integer schemaVersion, PackInfo pack, List<ClassificationRule> rules) {

  public static final String FORMAT = "log-explorer-classification-pack";
  public static final String DEFAULT_FILE_NAME = "log-explorer-classification-pack.json";

  public ClassificationPack {
    rules = rules == null ? List.of() : Collections.unmodifiableList(new ArrayList<>(rules));
  }

  @JsonInclude(JsonInclude.Include.NON_NULL)
  public record PackInfo(String name, String description, String version, Instant exportedAt) {
  }
}
