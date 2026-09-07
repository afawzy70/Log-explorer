package com.logexplorer.config;

import java.util.HashSet;
import java.util.Set;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** {@code logexplorer.sources.*} — see .env.example (added in Phase K) for the runtime knobs this backs. */
@ConfigurationProperties(prefix = "logexplorer.sources")
public class SourcesProperties {

  /** Source IDs disabled by configuration, even if a bean for them is registered. */
  private Set<String> disabled = new HashSet<>();

  public Set<String> getDisabled() {
    return disabled;
  }

  public void setDisabled(Set<String> disabled) {
    this.disabled = disabled;
  }
}
