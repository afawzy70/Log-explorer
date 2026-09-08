package com.logexplorer.source.loki;

import com.logexplorer.config.LokiProperties;
import com.logexplorer.core.model.RawToken;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

/**
 * Calls the Loki gateway's {@code query_range} endpoint
 * (IMPLEMENTATION_PLAN.md "Phase D" scope item 2: "correct start/end
 * (nanoseconds), direction, limit, timestamp semantics"), with every path
 * segment built from {@link LokiProperties} — nothing hardcoded.
 */
@Component
public class LokiQueryClient {

  private final LokiProperties properties;
  private final LokiTokenSupplier tokenSupplier;
  private final WebClient webClient;

  public LokiQueryClient(LokiProperties properties, LokiTokenSupplier tokenSupplier, LokiWebClientFactory webClientFactory) {
    this.properties = properties;
    this.tokenSupplier = tokenSupplier;
    this.webClient = webClientFactory.create(properties);
  }

  /**
   * @param direction {@code "forward"} (ascending) or {@code "backward"} (descending)
   */
  public Mono<LokiQueryResponse> queryRange(String query, long startNanos, long endNanos, int limit, String direction) {
    String path = properties.getGatewayPrefix() + "/" + properties.getTenant() + "/loki/api/v1/query_range";
    RawToken token = tokenSupplier.get();

    return webClient.get()
        // A LogQL selector value is literally "{label=\"value\"}" - if that
        // string were passed straight into queryParam(...) and then built
        // via a bare build(), UriComponents.expand() re-scans EVERY
        // component (including already-added query values) for "{...}"
        // patterns and tries to treat the selector's own braces as an
        // unfilled template variable. Using named template variables here
        // and supplying values via build(Object...) means expansion runs
        // exactly once, substituting each value in - the substituted
        // text is never rescanned for further "{...}" patterns.
        .uri(uriBuilder -> uriBuilder.path(path)
            .queryParam("query", "{query}")
            .queryParam("start", "{start}")
            .queryParam("end", "{end}")
            .queryParam("limit", "{limit}")
            .queryParam("direction", "{direction}")
            .build(query, startNanos, endNanos, limit, direction))
        .headers(headers -> {
          if (token.isPresent()) {
            headers.setBearerAuth(token.value());
          }
        })
        .exchangeToMono(response -> {
          if (response.statusCode().is2xxSuccessful()) {
            return response.bodyToMono(LokiQueryResponse.class);
          }
          return Mono.error(LokiErrorClassifier.classifyStatus(response.statusCode().value()));
        })
        .timeout(properties.getRequestTimeout())
        .onErrorMap(t -> !(t instanceof LokiRequestException), LokiErrorClassifier::classifyThrowable);
  }
}
