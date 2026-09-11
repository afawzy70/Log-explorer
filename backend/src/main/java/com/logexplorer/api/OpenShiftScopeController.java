package com.logexplorer.api;

import com.logexplorer.api.dto.OpenShiftContainerSelectionDto;
import com.logexplorer.api.dto.OpenShiftPodDto;
import com.logexplorer.api.dto.OpenShiftPodSelectionDto;
import com.logexplorer.api.dto.OpenShiftScopeSummaryDto;
import com.logexplorer.api.dto.OpenShiftWorkloadDiscoveryDto;
import com.logexplorer.api.dto.OpenShiftWorkloadDto;
import com.logexplorer.api.dto.OpenShiftWorkloadKindOutcomeDto;
import com.logexplorer.api.dto.OpenShiftWorkloadSelectionDto;
import com.logexplorer.source.openshift.OpenShiftScopeService;
import com.logexplorer.source.openshift.OpenShiftSession;
import com.logexplorer.source.openshift.PodSummary;
import com.logexplorer.source.openshift.WorkloadDiscovery;
import com.logexplorer.source.openshift.WorkloadKind;
import com.logexplorer.source.openshift.WorkloadRef;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * OS-1B - OpenShift workload/pod/container scope discovery, sitting
 * beside {@link OpenShiftConnectionController}'s connection/project
 * endpoints. Deliberately several small, source-specific endpoints rather
 * than one endpoint returning the whole cluster tree (OS-1B §16) - each
 * request is explicitly bounded by the currently-selected project/
 * workload/pod, never a cluster-wide fetch.
 *
 * <h2>Discovery only</h2>
 *
 * <p>Nothing here returns a log line. This is scope resolution for later
 * slices (OS-1C Search, OS-1E Live) - see {@link OpenShiftScopeService}'s
 * own javadoc for the discovery/validation contract these endpoints sit
 * on top of.
 */
@RestController
@RequestMapping("/api/v1/sources/openshift")
public class OpenShiftScopeController {

  private final OpenShiftScopeService scopeService;
  private final OpenShiftSession session;

  public OpenShiftScopeController(OpenShiftScopeService scopeService, OpenShiftSession session) {
    this.scopeService = scopeService;
    this.session = session;
  }

  @GetMapping("/workloads")
  public Mono<OpenShiftWorkloadDiscoveryDto> workloads() {
    return scopeService.discoverWorkloads().map(this::toDto);
  }

  private OpenShiftWorkloadDiscoveryDto toDto(WorkloadDiscovery discovery) {
    List<OpenShiftWorkloadDto> workloads = discovery.workloads().stream()
        .map(w -> new OpenShiftWorkloadDto(w.ref().kind().name(), w.ref().name(), w.desiredReplicas(),
            w.readyReplicas()))
        .toList();
    List<OpenShiftWorkloadKindOutcomeDto> outcomes = discovery.kindOutcomes().stream()
        .map(o -> new OpenShiftWorkloadKindOutcomeDto(o.kind().name(), o.status().name()))
        .toList();
    return new OpenShiftWorkloadDiscoveryDto(discovery.status().name(), workloads, outcomes);
  }

  /**
   * Commits (or clears, when both fields are blank) a workload selection.
   * Rejected with 400 when the workload is not one the last {@code
   * GET /workloads} call actually returned (OS-1B §13) - a stale or
   * fabricated selection is never silently applied.
   */
  @PutMapping("/workload")
  public ResponseEntity<OpenShiftScopeSummaryDto> selectWorkload(
      @Valid @RequestBody OpenShiftWorkloadSelectionDto selection) {
    WorkloadRef ref = toWorkloadRef(selection);
    if (selection.kind() != null && !selection.kind().isBlank() && ref == null) {
      // An unrecognised kind string is a caller mistake, not a valid "clear" request.
      return ResponseEntity.badRequest().body(scopeSummary());
    }
    boolean applied = scopeService.selectWorkload(ref);
    return applied ? ResponseEntity.ok(scopeSummary()) : ResponseEntity.badRequest().body(scopeSummary());
  }

  private WorkloadRef toWorkloadRef(OpenShiftWorkloadSelectionDto selection) {
    if (selection.kind() == null || selection.kind().isBlank() || selection.name() == null
        || selection.name().isBlank()) {
      return null; // "All workloads"
    }
    String namespace = session.selectedProject();
    if (namespace == null) {
      return null;
    }
    try {
      return new WorkloadRef(WorkloadKind.valueOf(selection.kind()), selection.name(), namespace);
    } catch (IllegalArgumentException e) {
      return null; // unrecognised kind - caller error, surfaced as a rejected selection above
    }
  }

  @GetMapping("/pods")
  public Mono<List<OpenShiftPodDto>> pods() {
    return scopeService.discoverPods().map(pods -> pods.stream().map(this::toDto).toList());
  }

  private OpenShiftPodDto toDto(PodSummary pod) {
    return new OpenShiftPodDto(
        pod.name(),
        pod.phase(),
        pod.readySummary(),
        pod.restartCount(),
        pod.containerNames(),
        pod.workload() != null ? pod.workload().kind().name() : null,
        pod.workload() != null ? pod.workload().name() : null);
  }

  /**
   * Commits (or clears) a pod selection. Rejected with 400 when the pod is
   * not one the last {@code GET /pods} call actually returned (OS-1B §13).
   */
  @PutMapping("/pod")
  public ResponseEntity<OpenShiftScopeSummaryDto> selectPod(@Valid @RequestBody OpenShiftPodSelectionDto selection) {
    String pod = selection.pod() != null && !selection.pod().isBlank() ? selection.pod() : null;
    boolean applied = scopeService.selectPod(pod);
    return applied ? ResponseEntity.ok(scopeSummary()) : ResponseEntity.badRequest().body(scopeSummary());
  }

  /**
   * Container names for the currently-selected pod - empty when no pod is
   * selected (OS-1B §11). Served from the cached pod summary, no extra
   * cluster call (see {@link OpenShiftScopeService#discoverContainers()}).
   */
  @GetMapping("/containers")
  public ResponseEntity<List<String>> containers() {
    return ResponseEntity.ok(scopeService.discoverContainers());
  }

  /**
   * Commits (or clears) a container selection. Rejected with 400 when the
   * container is not one the current pod actually has (OS-1B §13).
   */
  @PutMapping("/container")
  public ResponseEntity<OpenShiftScopeSummaryDto> selectContainer(
      @Valid @RequestBody OpenShiftContainerSelectionDto selection) {
    String container = selection.container() != null && !selection.container().isBlank()
        ? selection.container()
        : null;
    boolean applied = scopeService.selectContainer(container);
    return applied ? ResponseEntity.ok(scopeSummary()) : ResponseEntity.badRequest().body(scopeSummary());
  }

  private OpenShiftScopeSummaryDto scopeSummary() {
    var scope = session.scope();
    WorkloadRef workload = scope.selectedWorkload();
    String discoveryApi = session.discoveryApi() != null ? session.discoveryApi().name() : null;
    return new OpenShiftScopeSummaryDto(
        session.selectedProject(),
        discoveryApi,
        workload != null ? workload.kind().name() : null,
        workload != null ? workload.name() : null,
        scope.selectedPod(),
        scope.selectedContainer());
  }
}
