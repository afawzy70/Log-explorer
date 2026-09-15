package com.logexplorer.core.classify;

import com.logexplorer.core.model.CanonicalLogEvent;

/**
 * Applies the active classification rules to a freshly parsed canonical
 * event. Called once per event by {@code core.parse.LogLineParser}, so every
 * source (Docker, Loki, OpenShift, Fixture) and every workspace (search,
 * context, journey, live) shares one classification path.
 */
public interface EventClassifier {

  EventClassifier NONE = new EventClassifier() {
    @Override
    public CanonicalLogEvent classify(CanonicalLogEvent event) {
      return event;
    }

    @Override
    public long generation() {
      return 0;
    }
  };

  CanonicalLogEvent classify(CanonicalLogEvent event);

  /** Changes whenever the active rule set changes — lets a caller that caches parsed events detect staleness. */
  long generation();
}
