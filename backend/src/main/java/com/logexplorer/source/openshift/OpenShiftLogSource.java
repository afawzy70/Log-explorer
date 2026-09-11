package com.logexplorer.source.openshift;

import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.SearchRequest;
import com.logexplorer.core.model.ServiceInfo;
import com.logexplorer.core.model.SourceCapabilities;
import com.logexplorer.core.model.SourceHealth;
import com.logexplorer.source.LogSource;
import java.time.Instant;
import java.util.List;
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
 * <h2>OS-1C — bounded direct search is now real</h2>
 *
 * <p>{@link #search} delegates to {@link DirectPodLogProvider}, which
 * consumes the current OS-1B scope exactly as resolved (never re-derives
 * "All workloads"/"All pods" itself) and returns a bounded, deterministically
 * merged result over the Kubernetes/OpenShift pod-log API — never an
 * indexed historical store, never a live stream (OS-1E), never context/
 * correlation fan-out (OS-1D). {@code historicalSearch} now truthfully
 * means "bounded direct search over currently-resolved pods," not
 * "indexed history" — see the OS-1C verification report for why that
 * distinction matters and how {@code pagination} stays honestly
 * {@code false}.
 */
@Component
public class OpenShiftLogSource implements LogSource {

  private final OpenShiftSession session;
  private final DirectPodLogProvider directPodLogProvider;

  public OpenShiftLogSource(OpenShiftSession session, DirectPodLogProvider directPodLogProvider) {
    this.session = session;
    this.directPodLogProvider = directPodLogProvider;
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
    // historicalSearch is now true (OS-1C) - bounded direct search over
    // whatever pods/containers OS-1B's scope currently resolves to. Every
    // other capability stays false and unchanged from OS-1A/1B:
    // liveTail/contextView are OS-1D/1E's job; rawLogQL is Loki-only and
    // this is not Loki; serviceDiscovery/composeProjectScoping are
    // Docker-shaped concepts this source expresses through its own OS-1B
    // scope endpoints instead, not this seven-boolean record;
    // queryStatistics was never implemented for any source. Pagination is
    // not a field of this record (see api.dto.SearchResponseDto's own
    // "pagination" reporting, which is derived from whether a result
    // actually carries a nextCursor - OS-1C's own DirectPodLogProvider
    // never produces one, so that stays honestly false without this
    // source needing to say so twice).
    return new SourceCapabilities(true, false, false, false, false, false, false);
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
   *
   * <p>OS-1C adds one further distinction (§26): a connection that is
   * genuinely {@code CONNECTED} but has no project/namespace selected
   * cannot usefully search yet either - reported as {@code DEGRADED}, not
   * {@code UP}, with a warning naming exactly what is missing, never
   * conflated with the "session has expired" truth.
   */
  @Override
  public Mono<SourceHealth> health() {
    Instant now = Instant.now();
    return Mono.just(switch (session.state()) {
      case CONNECTED -> session.selectedProject() == null
          ? new SourceHealth(
              SourceHealth.Status.DEGRADED,
              "Connected to " + session.serverDisplay() + ", but no project/namespace is selected",
              now,
              List.of("Select a project/namespace in Settings to search"))
          : new SourceHealth(
              SourceHealth.Status.UP,
              "Connected to " + session.serverDisplay() + " (" + session.selectedProject() + ")",
              now);
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
    // Workload/service discovery is exposed through OS-1B's own dedicated
    // scope endpoints (/workloads, /pods, /containers), not this generic,
    // Docker-shaped service-discovery surface - reporting
    // serviceDiscovery=false above and returning empty here stay
    // consistent with each other.
    return Flux.empty();
  }

  @Override
  public Flux<CanonicalLogEvent> search(SearchRequest request) {
    return directPodLogProvider.search(request);
  }

  @Override
  public List<String> describeScopeWarnings(SearchRequest request) {
    return directPodLogProvider.describeScopeWarnings(request);
  }
}
