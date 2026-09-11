package com.logexplorer.source.openshift;

import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.model.ServiceInfo;
import com.logexplorer.core.model.SourceCapabilities;
import com.logexplorer.core.model.SourceHealth;
import com.logexplorer.source.LogSource;
import java.time.Instant;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

/**
 * The first-class OpenShift source (OS-1A §5). Stable id {@code
 * "openshift"}.
 *
 * <h2>One source, one connection</h2>
 *
 * <p>A single Spring-managed bean, exactly like every other source: {@code
 * LogSourceRegistry} builds an immutable map from the injected beans, so
 * sources are fixed at startup and no id is ever generated at runtime.
 * "Add Source → OpenShift" therefore means <i>configure and connect this
 * source</i>, not <i>create a new one</i>. Multi-cluster remains out of
 * scope (CLAUDE.md §8), which is what makes that model correct rather than
 * merely convenient.
 *
 * <h2>Capabilities are deliberately almost all false in OS-1A</h2>
 *
 * <p>This slice can connect, authenticate and discover projects. It cannot
 * search, tail or show context, because none of that is implemented yet -
 * OS-1B/1C/1D/1E own those. So every one of those capabilities reports
 * {@code false}, and {@link #search} refuses rather than returning an
 * empty result that would look like "no matching logs".
 *
 * <p>This matters more than it might seem. UX-R4 found a capability that
 * lied in the opposite direction ({@code contextView=false} while the
 * feature worked) and had to correct it; the frontend is built to trust
 * these flags completely and never infer. A source that advertised search
 * merely because it had connected would produce a control that silently
 * returns nothing.
 */
@Component
public class OpenShiftLogSource implements LogSource {

  private final OpenShiftSession session;

  public OpenShiftLogSource(OpenShiftSession session) {
    this.session = session;
  }

  @Override
  public String id() {
    return "openshift";
  }

  @Override
  public String displayName() {
    return "OpenShift";
  }

  @Override
  public SourceCapabilities capabilities() {
    // historicalSearch, liveTail, rawLogQL, serviceDiscovery,
    // queryStatistics, contextView, composeProjectScoping - all false in
    // OS-1A. Project discovery is a connection concern exposed through the
    // OpenShift connection API, not through this seven-boolean record,
    // which has no field that could express it truthfully (extending the
    // capability model belongs to OS-1C, where search capabilities first
    // become real).
    return new SourceCapabilities(false, false, false, false, false, false, false);
  }

  /**
   * Health reflects the live connection state, so the existing source
   * health badge tells the truth about OpenShift without a second,
   * parallel status mechanism.
   *
   * <p>{@code DISCONNECTED} is reported as {@code DEGRADED} rather than
   * {@code DOWN}: nothing is broken, the user simply has not signed in
   * yet, and showing a red "down" state for the normal starting condition
   * would be alarming and untrue.
   */
  @Override
  public Mono<SourceHealth> health() {
    Instant now = Instant.now();
    return Mono.just(switch (session.state()) {
      case CONNECTED -> new SourceHealth(
          SourceHealth.Status.UP, "Connected to " + session.serverDisplay(), now);
      case DISCONNECTED -> new SourceHealth(
          SourceHealth.Status.DEGRADED, "Not connected. Add an OpenShift connection in Settings.", now);
      case EXPIRED -> new SourceHealth(
          SourceHealth.Status.DOWN, "The OpenShift session has expired. Sign in again.", now);
      case FAILED -> new SourceHealth(
          SourceHealth.Status.DOWN, "The last OpenShift connection attempt failed.", now);
    });
  }

  @Override
  public Flux<ServiceInfo> discoverServices() {
    // Workload/service discovery is OS-1B. Reporting serviceDiscovery=false
    // above and returning empty here are consistent: the frontend never
    // offers a service filter for this source in OS-1A.
    return Flux.empty();
  }

  @Override
  public Flux<CanonicalLogEvent> search(SearchRequest request) {
    // Refuse loudly rather than return empty. An empty Flux would render as
    // "no results for this range", which is a factual claim about the
    // cluster's logs that this slice is in no position to make.
    return Flux.error(new UnsupportedOperationException(
        "Log search for the OpenShift source is not implemented yet (OS-1C)."));
  }
}
