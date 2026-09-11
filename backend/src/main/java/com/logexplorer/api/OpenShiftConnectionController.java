package com.logexplorer.api;

import com.logexplorer.api.dto.OpenShiftConnectRequestDto;
import com.logexplorer.api.dto.OpenShiftConnectionSummaryDto;
import com.logexplorer.api.dto.OpenShiftProjectSelectionDto;
import com.logexplorer.source.openshift.LoopbackBindingGuard;
import com.logexplorer.source.openshift.OpenShiftConnectionService;
import com.logexplorer.source.openshift.OpenShiftSession;
import com.logexplorer.source.openshift.ProjectDiscovery;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

/**
 * OpenShift connection endpoints (OS-1A §6/§17).
 *
 * <h2>Security shape</h2>
 *
 * <ul>
 *   <li><b>Credential intake is loopback-only.</b> {@code POST /connect}
 *   calls {@link LoopbackBindingGuard#requireLoopback()} before doing
 *   anything else - including before parsing the pasted command. This
 *   application has no authentication of its own, so the loopback binding
 *   <i>is</i> the boundary, and it is checked rather than assumed.</li>
 *   <li><b>There is no token read path.</b> Every response here is an
 *   {@link OpenShiftConnectionSummaryDto}, which has no field capable of
 *   carrying the token, a prefix of it, or the pasted command.</li>
 *   <li><b>Read-only against the cluster.</b> The only cluster calls made
 *   are {@code GET}s (CLAUDE.md §2 rule 9).</li>
 * </ul>
 *
 * <p>Error translation lives in {@code GlobalExceptionHandler}, which maps
 * each failure kind to a distinct status and a message safe to display -
 * never one containing the credential.
 */
@RestController
@RequestMapping("/api/v1/sources/openshift")
public class OpenShiftConnectionController {

  private final OpenShiftConnectionService service;
  private final OpenShiftSession session;
  private final LoopbackBindingGuard bindingGuard;

  public OpenShiftConnectionController(
      OpenShiftConnectionService service, OpenShiftSession session, LoopbackBindingGuard bindingGuard) {
    this.service = service;
    this.session = session;
    this.bindingGuard = bindingGuard;
  }

  /** Current connection state. Safe to call at any time; never returns a credential. */
  @GetMapping("/connection")
  public OpenShiftConnectionSummaryDto connection() {
    return summarize(null);
  }

  /**
   * Whether this instance may accept credentials at all, so the UI can
   * explain <i>why</i> the form is unavailable instead of failing on
   * submit.
   */
  @GetMapping("/connection/intake-allowed")
  public ResponseEntity<Boolean> intakeAllowed() {
    return ResponseEntity.ok(bindingGuard.isLoopbackBound());
  }

  @PostMapping("/connect")
  public Mono<OpenShiftConnectionSummaryDto> connect(@Valid @RequestBody OpenShiftConnectRequestDto request) {
    return service
        .connect(request.loginCommand(), request.connectionName())
        .map(connected -> summarize(null));
  }

  @DeleteMapping("/connect")
  public OpenShiftConnectionSummaryDto disconnect() {
    service.disconnect();
    return summarize(null);
  }

  /** Re-runs project discovery against the current connection. */
  @PostMapping("/projects/refresh")
  public Mono<OpenShiftConnectionSummaryDto> refreshProjects() {
    return service.refreshProjects().map(this::summarize);
  }

  /**
   * Commits the selected project. Rejected when the project is not one the
   * current connection can actually see - a stale selection from a
   * previous connection must never be applied to a new one.
   */
  @PutMapping("/project")
  public ResponseEntity<OpenShiftConnectionSummaryDto> selectProject(
      @Valid @RequestBody OpenShiftProjectSelectionDto selection) {
    boolean applied = session.selectProject(selection.project(), session.generation());
    if (!applied) {
      return ResponseEntity.badRequest().body(summarize(null));
    }
    return ResponseEntity.ok(summarize(null));
  }

  private OpenShiftConnectionSummaryDto summarize(ProjectDiscovery discovery) {
    List<String> projects = discovery != null ? discovery.projects() : session.projects();
    String api = discovery != null ? discovery.api().name() : null;
    return new OpenShiftConnectionSummaryDto(
        session.state().name(),
        session.connectionName(),
        session.serverDisplay(),
        session.username(),
        projects.size(),
        projects,
        session.selectedProject(),
        session.isConnected(),
        session.certificateAuthorityPath() != null,
        session.proxyDisplay(),
        api);
  }
}
