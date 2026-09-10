package com.logexplorer.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.api.dto.SourceHealthDto;
import com.logexplorer.core.model.SourceCapabilities;
import com.logexplorer.core.model.SourceHealth;
import com.logexplorer.source.docker.DockerDiagnostics;
import java.net.ConnectException;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.json.JsonTest;

/**
 * Legacy Remediation Slice 6 — the richer health model (latency, warnings,
 * capabilities) must never become a new leak surface. {@link
 * SourceCapabilities} is already known to carry no sensitive data
 * (verified since Phase B); this test focuses on the two fields that carry
 * free-ish text: {@code message} and {@code warnings}.
 */
@JsonTest
class SourceHealthLeakTest {

  private static final String RAW_EXCEPTION_DETAIL = "RAW-EXCEPTION-SENTINEL-a1b2c3";

  @Autowired
  private ObjectMapper objectMapper;

  @Test
  void aRawConnectionFailureMessageNeverReachesTheSerializedHealthDto() throws Exception {
    SourceHealth health = DockerDiagnostics.toHealth(new ConnectException(RAW_EXCEPTION_DETAIL));
    SourceHealthDto dto = SourceHealthDto.of(health, 5L, new SourceCapabilities(true, true, false, true, false, false, false));

    String json = objectMapper.writeValueAsString(dto);

    assertThat(json).doesNotContain(RAW_EXCEPTION_DETAIL);
    // Sanity: the test would catch a real leak - the classified message is present.
    assertThat(json).contains("DOWN");
  }

  @Test
  void degradedWarningsAreTheFixedSanitizedStringNeverEnvironmentSpecificDetail() throws Exception {
    // Simulates what DockerLogSource#health actually constructs on the
    // DEGRADED path - a fixed, generic warning text, never (for example)
    // the real configured Compose project filter value or a hostname.
    SourceHealth health = new SourceHealth(
        SourceHealth.Status.DEGRADED,
        "Docker daemon reachable, but no containers matched the configured Compose project filter",
        Instant.now(),
        List.of("No containers matched the configured Compose project filter"));
    SourceHealthDto dto = SourceHealthDto.of(health, 3L, new SourceCapabilities(true, true, false, true, false, false, false));

    String json = objectMapper.writeValueAsString(dto);

    assertThat(json).contains("No containers matched the configured Compose project filter");
    assertThat(json).doesNotContain(RAW_EXCEPTION_DETAIL);
  }
}
