package com.logexplorer.core.model;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

class CanonicalLogEventTest {

  @Test
  void constructorAcceptsUnknownFieldMapsContainingANullValue() {
    // Regression test for a real NullPointerException found against real
    // Docker container logs: the canonical constructor used to call
    // Map.copyOf on unknownTopLevelFields/unknownMdcFields, which throws
    // on any null *value* - but a JSON `null` is an ordinary, valid value
    // for a field this codebase has never heard of, not a malformed one.
    Map<String, Object> topLevelWithNull = new HashMap<>();
    topLevelWithNull.put("someFutureField", null);
    Map<String, Object> mdcWithNull = new HashMap<>();
    mdcWithNull.put("weirdCustomField", null);

    CanonicalLogEvent event = CanonicalLogEvent.builder()
        .message("m")
        .unknownTopLevelFields(topLevelWithNull)
        .unknownMdcFields(mdcWithNull)
        .build();

    assertThat(event.unknownTopLevelFields()).containsEntry("someFutureField", null);
    assertThat(event.unknownMdcFields()).containsEntry("weirdCustomField", null);
  }

  @Test
  void toBuilderRoundTripsEveryFieldIncludingAdapterEnrichment() {
    CanonicalLogEvent original = CanonicalLogEvent.builder()
        .timestamp(Instant.parse("2026-01-01T00:00:00Z"))
        .timestampRaw("2026-01-01T00:00:00+00:00")
        .schemaVersion("1")
        .service("gateway")
        .serviceSourceHint("gateway-compose")
        .severity("ERROR")
        .severityNumber(40000)
        .message("boom")
        .logger("com.example.Foo")
        .thread("t-1")
        .exception("java.lang.RuntimeException: boom")
        .traceId("trace-1")
        .spanId("span-1")
        .journeyId("journey-1")
        .eventId("event-1")
        .businessStep("step-1")
        .uiIdentifier("ui-1")
        .errorCode("ERR_1")
        .correlationId("corr-1")
        .sensitive(new RawSensitiveFields("cif", "user", "cust", "dev", "1.2.3.4"))
        .devicePlatformType("WEB")
        .language("en")
        .serverIp("10.0.0.1")
        .serverHost("host-1")
        .unknownTopLevelFields(Map.of("x", 1))
        .unknownMdcFields(Map.of("y", 2))
        .malformed(false)
        .rawLine(null)
        .sourceId("local-docker")
        .composeProject("myproject")
        .containerId("container-1")
        .containerName("myproject-gateway-1")
        .stream("stdout")
        .namespace("my-namespace")
        .pod("my-pod-abc123")
        .build();

    CanonicalLogEvent copy = original.toBuilder().build();

    assertThat(copy).isEqualTo(original);
  }

  @Test
  void toBuilderAllowsOverridingJustTheEnrichmentFields() {
    CanonicalLogEvent original = CanonicalLogEvent.builder()
        .message("hello")
        .service("gateway")
        .build();

    CanonicalLogEvent enriched = original.toBuilder()
        .sourceId("local-docker")
        .containerId("abc123")
        .build();

    assertThat(enriched.message()).isEqualTo("hello");
    assertThat(enriched.service()).isEqualTo("gateway");
    assertThat(enriched.sourceId()).isEqualTo("local-docker");
    assertThat(enriched.containerId()).isEqualTo("abc123");
  }
}
