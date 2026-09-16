package com.logexplorer.core.mask;

import static org.assertj.core.api.Assertions.assertThat;

import com.logexplorer.core.model.CanonicalLogEvent;
import com.logexplorer.core.model.ExtractedField;
import com.logexplorer.core.model.RawSensitiveFields;
import org.junit.jupiter.api.Test;

class ExtractedValueRedactorTest {

  private final MaskingPolicyService policy = new MaskingPolicyService();
  private final ExtractedValueRedactor redactor =
      new ExtractedValueRedactor(new MaskingService(policy), new TextRedactor());
  private final CanonicalLogEvent event = CanonicalLogEvent.builder()
      .message("m")
      .sensitive(new RawSensitiveFields("FAKE-CIF-0001", "fixture.user7", "DEMO-CUST-123456", "DEMO-DEVICE-001", "10.1.2.3"))
      .build();

  private static ExtractedField present(String name, String value) {
    return new ExtractedField(name, null, value, ExtractedField.Status.PRESENT, false);
  }

  @Test
  void credentialHeadersAreRedactedInHeaderTextAndJson() {
    String headers = "Authorization: Bearer abc.def.ghi\nProxy-Authorization: Basic Zm9vOmJhcg==\n"
        + "Cookie: session=s3cr3t; theme=dark\nSet-Cookie: id=xyz; Path=/\nX-API-Key: key-123456\n"
        + "Accept: application/json";
    String redacted = redactor.redactText(event, headers);
    assertThat(redacted).doesNotContain("abc.def.ghi", "Zm9vOmJhcg==", "s3cr3t", "id=xyz", "key-123456");
    assertThat(redacted).contains("Accept: application/json", "Authorization: [REDACTED]");

    String json = "{\"Authorization\":\"Bearer abc\",\"x-api-key\":\"k-1\",\"access_token\":\"t-2\",\"accept\":\"json\"}";
    String redactedJson = redactor.redactText(event, json);
    assertThat(redactedJson).doesNotContain("Bearer abc", "k-1", "t-2").contains("\"accept\":\"json\"");
  }

  @Test
  void sensitiveDefinitionsAndCredentialLikeNamesAreNeverShown() {
    ExtractedField sensitive = new ExtractedField("requestBody", "Request body", "{\"amount\":1}",
        ExtractedField.Status.PRESENT, true);
    assertThat(redactor.present(event, sensitive, 100).value()).isEqualTo(ExtractedValueRedactor.REDACTED);
    assertThat(redactor.present(event, present("authorizationHeader", "anything"), 100).value())
        .isEqualTo(ExtractedValueRedactor.REDACTED);
    assertThat(redactor.present(event, present("sessionId", "abc"), 100).redacted()).isTrue();
    assertThat(redactor.present(event, present("responseCode", "200"), 100).value()).isEqualTo("200");
  }

  @Test
  void protectedIdentifiersInsideExtractedTextFollowTheMaskingPolicy() {
    String body = "{\"customer\":\"DEMO-CUST-123456\",\"device\":\"DEMO-DEVICE-001\"}";
    assertThat(redactor.present(event, present("body", body), 500).value()).contains("DEMO-DEVICE-001");
    policy.setMasked(ProtectedField.DEVICE_ID, true);
    ExtractedValueRedactor.Presented masked = redactor.present(event, present("body", body), 500);
    assertThat(masked.value()).doesNotContain("DEMO-DEVICE-001");
    assertThat(masked.redacted()).isTrue();
  }

  @Test
  void absentValuesStayAbsentAndLongValuesAreTruncatedWithAFlag() {
    ExtractedField absent = ExtractedField.absent("url", null, false);
    assertThat(redactor.present(event, absent, 10).value()).isNull();
    ExtractedValueRedactor.Presented truncated = redactor.present(event, present("body", "x".repeat(50)), 10);
    assertThat(truncated.value()).hasSize(10);
    assertThat(truncated.truncated()).isTrue();
  }
}
