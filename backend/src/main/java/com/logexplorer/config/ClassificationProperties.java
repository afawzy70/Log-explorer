package com.logexplorer.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Owner mission "Event Classification, Extraction, and Portable Rules" —
 * where the server-side classification rules configuration lives.
 *
 * <p>This is <b>configuration</b>, not log storage: it holds user-authored
 * rules only (never events, samples, or extracted runtime values). The
 * default resolves through {@code LOGEXPLORER_DATA_DIR} (see {@code
 * application.yml}) so each packaging keeps rules in a location that
 * survives its own upgrade/recreate cycle: a mounted volume in Docker, a
 * per-user application-data directory in the desktop launchers. Nothing is
 * created on disk until the first rule is saved.
 */
@ConfigurationProperties(prefix = "logexplorer.classification")
public class ClassificationProperties {

  private String rulesFile = "./data/classification-rules.json";

  public String getRulesFile() {
    return rulesFile;
  }

  public void setRulesFile(String rulesFile) {
    this.rulesFile = rulesFile;
  }
}
