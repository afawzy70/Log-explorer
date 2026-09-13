package com.logexplorer.api;

import com.logexplorer.api.dto.MaskingFieldUpdateRequestDto;
import com.logexplorer.api.dto.MaskingSettingsDto;
import com.logexplorer.core.mask.MaskingPolicyService;
import com.logexplorer.core.mask.ProtectedField;
import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Pre-closure functional recovery (§11/§12/§13/§16): protected-field
 * masking policy — deliberately its own top-level, source-independent
 * endpoint ({@code /api/v1/settings/masking}), not nested under {@code
 * /sources/docker} or {@code /sources/openshift}, because masking is a
 * GLOBAL application concern that applies identically to every source
 * (Fixture/Docker/OpenShift/Loki) — the owner's own explicit correction of
 * the prior, incorrect placement under Docker Settings.
 *
 * <p><b>Owner decision — same unauthenticated-local-tool trust model as
 * every other settings endpoint in this application</b> ({@link
 * DockerSettingsController}, {@link OpenShiftConnectionController}): this
 * application has no authenticated admin boundary, and the person running
 * the backend and the person using the browser are the same person on the
 * same machine. Unlike a hypothetical Docker-host-redirect endpoint
 * (deliberately never built — see {@link DockerSettingsController}'s own
 * doc comment), toggling a masking preference carries no SSRF-shaped or
 * cross-boundary risk: it only changes what THIS backend sends to ITS OWN
 * frontend, on the same machine, going forward. It is exactly the same
 * risk class as {@code OpenShiftConnectionController}'s own unauthenticated
 * local session-mutation endpoints.
 *
 * <p>The policy itself lives in {@link MaskingPolicyService} — this
 * controller is a thin read/write surface over it, never holding or
 * computing masking state itself.
 */
@RestController
@RequestMapping("/api/v1/settings/masking")
public class MaskingSettingsController {

  private final MaskingPolicyService policy;

  public MaskingSettingsController(MaskingPolicyService policy) {
    this.policy = policy;
  }

  @GetMapping
  public MaskingSettingsDto current() {
    return toDto(policy.currentPolicy());
  }

  @PutMapping
  public MaskingSettingsDto update(@Valid @RequestBody MaskingFieldUpdateRequestDto request) {
    ProtectedField field;
    try {
      field = ProtectedField.fromKey(request.field());
    } catch (IllegalArgumentException e) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown protected field: '" + request.field() + "'");
    }
    policy.setMasked(field, request.masked());
    return toDto(policy.currentPolicy());
  }

  private MaskingSettingsDto toDto(Map<ProtectedField, Boolean> currentPolicy) {
    return new MaskingSettingsDto(
        currentPolicy.get(ProtectedField.CIF),
        currentPolicy.get(ProtectedField.USER_NAME),
        currentPolicy.get(ProtectedField.CUSTOMER_ID),
        currentPolicy.get(ProtectedField.DEVICE_ID),
        currentPolicy.get(ProtectedField.DEVICE_IP));
  }
}
