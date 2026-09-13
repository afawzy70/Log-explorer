package com.logexplorer.api;

import com.logexplorer.api.dto.OpenShiftConnectRequestDto;
import com.logexplorer.api.dto.OpenShiftConnectionSummaryDto;
import com.logexplorer.api.dto.OpenShiftProjectSelectionDto;
import com.logexplorer.api.dto.OpenShiftProxySettingsDto;
import com.logexplorer.source.openshift.LoopbackBindingGuard;
import com.logexplorer.source.openshift.OpenShiftConnectionService;
import com.logexplorer.source.openshift.OpenShiftProxyConfigService;
import com.logexplorer.source.openshift.OpenShiftSession;
import com.logexplorer.source.openshift.ProjectDiscovery;
import com.logexplorer.source.openshift.ProxyConfig;
import com.logexplorer.source.openshift.ProxyMode;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
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
 *   <li><b>Pre-closure functional recovery 2 (§B15) - {@code GET}/{@code
 *   PUT /proxy} are deliberately NOT loopback-gated,</b> unlike {@code
 *   POST /connect}. A proxy host/port is not a credential (unlike a
 *   bearer token), and the same unauthenticated-local-tool trust model
 *   {@link com.logexplorer.api.MaskingSettingsController}'s own doc
 *   comment already establishes applies here identically: this backend
 *   has no authentication boundary of its own, the person running it and
 *   the person using the browser are the same person on the same
 *   machine, and there is no SSRF-shaped risk - the setting only changes
 *   which proxy THIS backend's own outbound OpenShift/Loki calls use,
 *   never an arbitrary redirect a remote caller controls.</li>
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
  private final OpenShiftProxyConfigService proxyConfigService;

  public OpenShiftConnectionController(
      OpenShiftConnectionService service, OpenShiftSession session, LoopbackBindingGuard bindingGuard,
      OpenShiftProxyConfigService proxyConfigService) {
    this.service = service;
    this.session = session;
    this.bindingGuard = bindingGuard;
    this.proxyConfigService = proxyConfigService;
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

  /**
   * The current OpenShift/Loki proxy setting (pre-closure functional
   * recovery 2, §B2/§B16) - independent of whether a connection currently
   * exists, since it applies to the connect attempt itself.
   */
  @GetMapping("/proxy")
  public OpenShiftProxySettingsDto proxySettings() {
    return toDto(proxyConfigService.current());
  }

  /**
   * Sets the proxy mode/host/port. {@code CUSTOM} requires a non-blank
   * host and a port in {@code 1..65535} (§B4) - rejected with {@code 400}
   * and a clear message otherwise, never silently coerced. Applies
   * immediately and consistently to every subsequent OpenShift API and
   * Loki call (§B5) - there is nothing further to "activate."
   */
  @PutMapping("/proxy")
  public OpenShiftProxySettingsDto updateProxySettings(@Valid @RequestBody OpenShiftProxySettingsDto request) {
    ProxyMode mode;
    try {
      mode = ProxyMode.valueOf(request.mode());
    } catch (IllegalArgumentException | NullPointerException e) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown proxy mode: '" + request.mode() + "'");
    }
    ProxyConfig config = new ProxyConfig(mode, request.host(), request.port());
    try {
      proxyConfigService.update(config);
    } catch (IllegalArgumentException e) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, e.getMessage());
    }
    return toDto(proxyConfigService.current());
  }

  private OpenShiftProxySettingsDto toDto(ProxyConfig config) {
    return new OpenShiftProxySettingsDto(config.mode().name(), config.customHost(), config.customPort());
  }

  /**
   * Builds the safe summary. {@code discovery} is supplied only by the
   * callers that just performed a fresh discovery call (connect,
   * refresh); every other caller passes {@code null} and this method
   * falls back to {@link OpenShiftSession#discoveryApi()} - the mode
   * persisted at connect/refresh time - rather than always reporting
   * {@code null} (OS-1A review recovery #2, Defect A). Without that
   * fallback, {@code GET /connection} - the readback every reconnect of
   * the UI relies on - could never truthfully report {@code NAMESPACES}
   * even though the session itself already knew it.
   */
  private OpenShiftConnectionSummaryDto summarize(ProjectDiscovery discovery) {
    List<String> projects = discovery != null ? discovery.projects() : session.projects();
    ProjectDiscovery.Api discoveryApi = discovery != null ? discovery.api() : session.discoveryApi();
    String api = discoveryApi != null ? discoveryApi.name() : null;
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
