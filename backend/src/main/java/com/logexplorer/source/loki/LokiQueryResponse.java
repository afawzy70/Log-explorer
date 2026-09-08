package com.logexplorer.source.loki;

import java.util.List;
import java.util.Map;

/** Loki {@code query_range} response shape, minimal - only what this adapter uses. */
public record LokiQueryResponse(String status, Data data) {

  public record Data(String resultType, List<StreamResult> result) {
  }

  public record StreamResult(Map<String, String> stream, List<List<String>> values) {
  }
}
