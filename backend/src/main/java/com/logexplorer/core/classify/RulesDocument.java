package com.logexplorer.core.classify;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * The internal, server-side rules configuration file
 * ({@code classification-rules.json}). Versioned from day one; {@code
 * revision} increases on every successful write and backs optimistic
 * concurrency (a stale write is rejected, never silently last-writer-wins).
 *
 * <p>Not the portable exchange format — see {@link ClassificationPack}.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record RulesDocument(String format, Integer schemaVersion, Long revision, Instant updatedAt,
    List<ClassificationRule> rules) {

  public static final String FORMAT = "log-explorer-classification-rules";

  public RulesDocument {
    rules = rules == null ? List.of() : Collections.unmodifiableList(new ArrayList<>(rules));
  }

  public static RulesDocument empty() {
    return new RulesDocument(FORMAT, RulesSchemaMigrator.CURRENT_SCHEMA_VERSION, 0L, null, List.of());
  }

  public long revisionOrZero() {
    return revision == null ? 0 : revision;
  }
}
