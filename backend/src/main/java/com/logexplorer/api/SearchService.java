package com.logexplorer.api;

import com.logexplorer.core.guard.ConcurrencyGuard;
import com.logexplorer.core.guard.SearchGuardrails;
import com.logexplorer.core.guard.ValidatedSearch;
import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.ResultCounts;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.model.SearchResult;
import com.logexplorer.source.LogSource;
import com.logexplorer.source.LogSourceRegistry;
import java.util.List;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * Orchestrates one bounded search: resolve the source, validate/derive
 * guardrails, apply the concurrency cap, request one more item than the
 * effective limit so truncation can be reported truthfully, and enforce
 * the request timeout. Every step is wrapped in {@link Mono#defer} so
 * validation failures (registry lookup, guardrail violations) surface as a
 * normal {@code Mono} error on subscription, not a thrown exception at
 * call time.
 */
@Component
public class SearchService {

  private final LogSourceRegistry registry;
  private final SearchGuardrails guardrails;
  private final ConcurrencyGuard concurrencyGuard;

  public SearchService(LogSourceRegistry registry, SearchGuardrails guardrails, ConcurrencyGuard concurrencyGuard) {
    this.registry = registry;
    this.guardrails = guardrails;
    this.concurrencyGuard = concurrencyGuard;
  }

  public Mono<SearchResult> search(SearchRequest request) {
    return Mono.defer(() -> {
      LogSource source = registry.require(request.sourceId());
      ValidatedSearch validated = guardrails.validate(request);

      Flux<CanonicalLogEvent> guarded = concurrencyGuard.guard(source.search(request));

      // Ask for one more than the effective limit so we can tell truncated
      // from exact without a separate count query, while never scanning or
      // buffering unbounded amounts of data regardless of what the source
      // implementation itself does.
      return guarded
          .take(validated.effectiveLimit() + 1)
          .collectList()
          .timeout(validated.timeout())
          .map(list -> toResult(list, validated.effectiveLimit()));
    });
  }

  private SearchResult toResult(List<CanonicalLogEvent> fetched, int effectiveLimit) {
    boolean truncated = fetched.size() > effectiveLimit;
    List<CanonicalLogEvent> page = truncated ? fetched.subList(0, effectiveLimit) : fetched;
    ResultCounts counts = new ResultCounts(null, page.size(), page.size(), effectiveLimit, truncated);
    return new SearchResult(page, counts, null);
  }
}
