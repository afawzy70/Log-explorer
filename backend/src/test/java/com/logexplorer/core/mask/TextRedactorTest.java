package com.logexplorer.core.mask;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * Legacy Remediation Slice 7 — conservative, high-confidence free-text
 * redaction. Every pattern's positive case (section 19 of the mission),
 * every negative/false-positive case (section 18), idempotence (section
 * 11), and the bounded unknown-field policy (section 9).
 */
class TextRedactorTest {

  private final TextRedactor redactor = new TextRedactor();

  // ---------------------------------------------------------------------
  // null / empty
  // ---------------------------------------------------------------------

  @Test
  void nullAndEmptyInputAreReturnedUnchanged() {
    assertThat(redactor.redact(null)).isNull();
    assertThat(redactor.redact("")).isEqualTo("");
  }

  @Test
  void ordinaryTextWithNothingSensitiveIsReturnedAsTheExactSameReference() {
    String text = "Loaded account summary in 42ms for request req-8891";
    assertThat(redactor.redact(text)).isSameAs(text);
  }

  // ---------------------------------------------------------------------
  // Section 19 - positive test set: contextual identifiers
  // ---------------------------------------------------------------------

  @ParameterizedTest
  @CsvSource({
      "'CIF 99887766 failed authentication', CIF=[REDACTED]",
      "'customerId=123456', customerId=[REDACTED]",
      "'customerId: 123456', customerId=[REDACTED]",
      "'customer_id=123456', customer_id=[REDACTED]",
      "'customer-id=123456', customer-id=[REDACTED]",
      "'CIF [123456]', CIF=[REDACTED]",
  })
  void contextualCustomerIdentifiersAreRedactedPreservingTheLabel(String input, String expectedFragment) {
    String out = redactor.redact(input);
    assertThat(out).contains(expectedFragment);
    assertThat(out).doesNotContain("123456").doesNotContain("99887766");
  }

  @Test
  void quotedJsonStyleCustomerIdIsRedacted() {
    String out = redactor.redact("event body: \"customerId\":\"123456\" received");
    assertThat(out).contains("customerId=[REDACTED]");
    assertThat(out).doesNotContain("123456");
  }

  @ParameterizedTest
  @CsvSource({
      "'username=jane.doe', username=[REDACTED]",
      "'userName: jane.doe', userName=[REDACTED]",
      "'user_name=jane.doe', user_name=[REDACTED]",
  })
  void usernameAliasesAreRedacted(String input, String expectedFragment) {
    String out = redactor.redact(input);
    assertThat(out).contains(expectedFragment);
    assertThat(out).doesNotContain("jane.doe");
  }

  @ParameterizedTest
  @CsvSource({
      "'deviceId: ABCD-1234-EFGH', deviceId=[REDACTED]",
      "'device_id=ABCD-1234-EFGH', device_id=[REDACTED]",
      "'device-id=ABCD-1234-EFGH', device-id=[REDACTED]",
  })
  void deviceIdAliasesAreRedacted(String input, String expectedFragment) {
    String out = redactor.redact(input);
    assertThat(out).contains(expectedFragment);
    assertThat(out).doesNotContain("ABCD-1234-EFGH");
  }

  @ParameterizedTest
  @CsvSource({
      "'deviceIp=10.0.0.14', deviceIp=[REDACTED]",
      "'clientIp=10.0.0.14', clientIp=[REDACTED]",
      "'customerIp=10.0.0.14', customerIp=[REDACTED]",
      "'userIp=10.0.0.14', userIp=[REDACTED]",
  })
  void userDeviceClientIpAliasesAreRedacted(String input, String expectedFragment) {
    String out = redactor.redact(input);
    assertThat(out).contains(expectedFragment);
    assertThat(out).doesNotContain("10.0.0.14");
  }

  @Test
  void serverInfrastructureIpIsNeverRedactedByFreeTextScanning() {
    // "serverIp"/"serverHost" are dedicated structured fields on
    // CanonicalLogEvent, never touched by TextRedactor at all - and a bare
    // "server ip"/"host" mention in free text (no user/device/client
    // label) must stay visible; infrastructure IPs are valuable evidence.
    String out = redactor.redact("connected from server ip 10.0.0.5 on host web-3");
    assertThat(out).contains("10.0.0.5");
  }

  // ---------------------------------------------------------------------
  // Section 19 - email (conservative, labeled-only policy)
  // ---------------------------------------------------------------------

  @ParameterizedTest
  @CsvSource({
      "'email=jane.doe@example.com', email=[REDACTED]",
      "'userEmail: jane.doe@example.com', userEmail=[REDACTED]",
      "'customerEmail=jane.doe@example.com', customerEmail=[REDACTED]",
  })
  void labeledEmailIsRedacted(String input, String expectedFragment) {
    String out = redactor.redact(input);
    assertThat(out).contains(expectedFragment);
    assertThat(out).doesNotContain("jane.doe@example.com");
  }

  @Test
  void unlabeledEmailMentionedForOperationalReasonsIsNeverRedacted() {
    // Conservative, documented policy (TextRedactor's own class javadoc):
    // no blanket email scanning - only when explicitly labeled.
    String out = redactor.redact("contact support at support@example.com for help");
    assertThat(out).contains("support@example.com");
  }

  // ---------------------------------------------------------------------
  // Section 19 / 2 - card numbers (Luhn-validated)
  // ---------------------------------------------------------------------

  @Test
  void validLuhnCardWithNoSeparatorsIsRedacted() {
    String out = redactor.redact("card 4111111111111111 declined");
    assertThat(out).isEqualTo("card [REDACTED_CARD] declined");
  }

  @Test
  void validLuhnCardWithSpacesIsRedacted() {
    String out = redactor.redact("card 4111 1111 1111 1111 declined");
    assertThat(out).isEqualTo("card [REDACTED_CARD] declined");
  }

  @Test
  void validLuhnCardWithHyphensIsRedacted() {
    String out = redactor.redact("card 4111-1111-1111-1111 declined");
    assertThat(out).isEqualTo("card [REDACTED_CARD] declined");
  }

  @Test
  void aRandomSixteenDigitNumberFailingLuhnRemainsVisible() {
    // 1234567890123456 fails Luhn (verified by hand: checksum 64 mod 10 = 4).
    String out = redactor.redact("referenceNumber=1234567890123456");
    assertThat(out).contains("1234567890123456");
  }

  // ---------------------------------------------------------------------
  // Section 18 - false-positive testing (mandatory)
  // ---------------------------------------------------------------------

  @ParameterizedTest
  @ValueSource(strings = {
      "2026-09-10T07:15:32Z",                          // timestamp
      "status=500",                                     // HTTP status
      "port=8080",                                       // port
      "duration=15000ms",                                 // duration
      "550e8400-e29b-41d4-a716-446655440000",            // UUID
      "traceId=fixture-trace-000006",                     // correlation/trace ID
      "1.2.3",                                            // version string
      "com.logexplorer.fixture.paymentsapi.Handler.handle", // Java package/class
      "https://example.com/api/v1/logs/search",           // URL without credentials/tokens
  })
  void ordinaryEngineeringValuesAreNeverRedacted(String value) {
    String message = "context: " + value + " end";
    assertThat(redactor.redact(message)).isEqualTo(message);
  }

  @Test
  void spanIdLikeHexValueIsNotRedacted() {
    String message = "spanId=a3f9c21e0b7d4f5a";
    assertThat(redactor.redact(message)).isEqualTo(message);
  }

  @Test
  void eventIdLikeValueIsNotRedacted() {
    String message = "eventId=fixture-event-000042";
    assertThat(redactor.redact(message)).isEqualTo(message);
  }

  @Test
  void aNormalServerIpWithNoUserDeviceClientLabelIsNotRedacted() {
    String message = "upstream call to serverIp=172.21.6.18 timed out";
    assertThat(redactor.redact(message)).isEqualTo(message);
  }

  @Test
  void aPhoneLikeNumberWithNoPaymentContextIsNotRedacted() {
    // 10-11 digits - well under the 13-digit card minimum, never even
    // evaluated for Luhn.
    String message = "call the customer back at +1 555-123-4567";
    assertThat(redactor.redact(message)).isEqualTo(message);
  }

  @Test
  void arbitraryLongNumericIdsAreNeverMaskedWithoutSensitiveContext() {
    String message = "orderNumber=9988776655443322 processed in batch #4471";
    // 16 digits but the label "orderNumber" is not a card/identifier
    // trigger - only Luhn validity (independent of any label) decides a
    // card; assert this exact digit string's own Luhn outcome honestly.
    boolean luhnValid = isLuhnValid("9988776655443322");
    String out = redactor.redact(message);
    if (luhnValid) {
      assertThat(out).contains("[REDACTED_CARD]");
    } else {
      assertThat(out).contains("9988776655443322");
    }
  }

  @Test
  void aDigitRunEmbeddedInsideALongerAlphanumericTokenIsNeverMatched() {
    String message = "sessionToken=ABC4111111111111111XYZ";
    assertThat(redactor.redact(message)).isEqualTo(message);
  }

  @Test
  void aFourSegmentDottedStringIsNeverMistakenForAJwt() {
    String message = "resolved class com.example.some.LongEnoughClassNameHere.NestedThingHere.Method";
    assertThat(redactor.redact(message)).isEqualTo(message);
  }

  @Test
  void shortDottedVersionSegmentsAreNeverMistakenForAJwt() {
    String message = "upgraded from 1.2.3 to 4.5.6";
    assertThat(redactor.redact(message)).isEqualTo(message);
  }

  // ---------------------------------------------------------------------
  // Section 19 - auth / secret material
  // ---------------------------------------------------------------------

  @Test
  void authorizationBearerIsRedactedPreservingTheWordBearer() {
    String out = redactor.redact("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcSignatureHere");
    assertThat(out).isEqualTo("Authorization: Bearer [REDACTED]");
  }

  @Test
  void basicAuthorizationPayloadIsRedacted() {
    String out = redactor.redact("Authorization: Basic dXNlcm5hbWU6cGFzc3dvcmQ=");
    assertThat(out).isEqualTo("Authorization: Basic [REDACTED]");
  }

  @ParameterizedTest
  @CsvSource({
      "'password=secret123', password=[REDACTED]",
      "'passwd=secret123', passwd=[REDACTED]",
      "'pwd=secret123', pwd=[REDACTED]",
      "'client_secret=secret123', client_secret=[REDACTED]",
      "'api_key=secret123', api_key=[REDACTED]",
      "'apikey=secret123', apikey=[REDACTED]",
      "'access_token=secret123', access_token=[REDACTED]",
      "'refresh_token=secret123', refresh_token=[REDACTED]",
  })
  void authSecretKeyValuePairsAreRedacted(String input, String expectedFragment) {
    String out = redactor.redact(input);
    assertThat(out).contains(expectedFragment);
    assertThat(out).doesNotContain("secret123");
  }

  // ---------------------------------------------------------------------
  // Section 19 / 4 - standalone JWT
  // ---------------------------------------------------------------------

  @Test
  void aStandaloneUnlabeledJwtIsRedacted() {
    String jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    String out = redactor.redact("token seen in log: " + jwt);
    assertThat(out).isEqualTo("token seen in log: [REDACTED_TOKEN]");
  }

  @Test
  void jwtNeverHasItsClaimsDecoded() {
    // The redactor performs a purely structural match - it never
    // base64-decodes a segment, so no claim content ever surfaces
    // anywhere, including in the replaced marker itself.
    String jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZW5zaXRpdmUtc3ViamVjdCJ9.signatureSignatureSignature";
    String out = redactor.redact(jwt);
    assertThat(out).isEqualTo("[REDACTED_TOKEN]");
    assertThat(out).doesNotContain("sensitive");
  }

  // ---------------------------------------------------------------------
  // Section 19 - combinations
  // ---------------------------------------------------------------------

  @Test
  void multipleSecretsInOneMessageAreAllRedacted() {
    String message = "Login failed for customerId=778899 card 4111 1111 1111 1111 declined password=Secret123!";
    String out = redactor.redact(message);
    assertThat(out).contains("customerId=[REDACTED]");
    assertThat(out).contains("[REDACTED_CARD]");
    assertThat(out).contains("password=[REDACTED]");
    assertThat(out).doesNotContain("778899").doesNotContain("4111").doesNotContain("Secret123!");
  }

  @Test
  void secretInsideExceptionMessageTextIsRedacted() {
    String exception = "java.lang.RuntimeException: auth failed, Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sigSigSigSigSig";
    String out = redactor.redact(exception);
    assertThat(out).contains("Authorization: Bearer [REDACTED]");
    assertThat(out).startsWith("java.lang.RuntimeException: auth failed");
  }

  @Test
  void secretInsideMultilineStackTraceTextIsRedactedWithoutDestroyingStackStructure() {
    String stack = String.join("\n",
        "java.lang.IllegalStateException: password=TopSecret99 leaked in log",
        "\tat com.logexplorer.fixture.payments.Handler.handle(Handler.java:57)",
        "Caused by: java.util.concurrent.TimeoutException: fixture timeout after 5000ms",
        "\t... 12 more");
    String out = redactor.redact(stack);
    assertThat(out).doesNotContain("TopSecret99");
    assertThat(out).contains("password=[REDACTED]");
    // Exception type, class names, method names, file names, line numbers, and stack structure all survive.
    assertThat(out).contains("java.lang.IllegalStateException");
    assertThat(out).contains("at com.logexplorer.fixture.payments.Handler.handle(Handler.java:57)");
    assertThat(out).contains("Caused by: java.util.concurrent.TimeoutException: fixture timeout after 5000ms");
    assertThat(out).contains("... 12 more");
    assertThat(out.split("\n", -1)).hasSize(4); // structure (4 lines) preserved exactly
  }

  @Test
  void mixedSafeAndSensitiveDataOnlyRedactsTheSensitivePart() {
    String message = "requestId=req-8891 durationMs=42 customerId=DEMO-778899 status=200";
    String out = redactor.redact(message);
    assertThat(out).contains("requestId=req-8891");
    assertThat(out).contains("durationMs=42");
    assertThat(out).contains("status=200");
    assertThat(out).contains("customerId=[REDACTED]");
    assertThat(out).doesNotContain("DEMO-778899");
  }

  // ---------------------------------------------------------------------
  // Section 11 - idempotence
  // ---------------------------------------------------------------------

  @Test
  void alreadyRedactedTextIsUnchangedByARepeatRun() {
    String[] inputs = {
        "customerId=778899 said something",
        "card 4111 1111 1111 1111 declined",
        "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sigSigSigSigSig",
        "password=Secret123!",
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sigSigSigSigSig standalone",
    };
    for (String input : inputs) {
      String once = redactor.redact(input);
      String twice = redactor.redact(once);
      assertThat(twice).as("redacting '%s' a second time", once).isEqualTo(once);
    }
  }

  @Test
  void redactingAnAlreadyPlainMarkerStringIsAStableFixedPoint() {
    assertThat(redactor.redact("[REDACTED]")).isEqualTo("[REDACTED]");
    assertThat(redactor.redact("[REDACTED_CARD]")).isEqualTo("[REDACTED_CARD]");
    assertThat(redactor.redact("[REDACTED_TOKEN]")).isEqualTo("[REDACTED_TOKEN]");
  }

  @Test
  void tripleApplicationIsIdenticalToSingleApplication() {
    String input = "customerId=778899 card 4111 1111 1111 1111 password=Secret123!";
    String once = redactor.redact(input);
    String twice = redactor.redact(once);
    String thrice = redactor.redact(twice);
    assertThat(thrice).isEqualTo(once);
  }

  // ---------------------------------------------------------------------
  // Section 9 - unknown/custom field policy (bounded, depth 0)
  // ---------------------------------------------------------------------

  @Test
  void redactStringValuesOnlyTouchesImmediateStringValuesNeverRecursing() {
    Map<String, Object> nested = new HashMap<>();
    nested.put("customerId", "778899"); // nested map - never scanned, depth-0 only
    Map<String, Object> fields = new HashMap<>();
    fields.put("plainString", "customerId=778899");
    fields.put("aNumber", 42);
    fields.put("aBoolean", true);
    fields.put("aNestedMap", nested);

    Map<String, Object> out = redactor.redactStringValues(fields);

    assertThat(out.get("plainString")).isEqualTo("customerId=[REDACTED]");
    assertThat(out.get("aNumber")).isEqualTo(42);
    assertThat(out.get("aBoolean")).isEqualTo(true);
    // The nested map is returned completely untouched - no recursion.
    assertThat(out.get("aNestedMap")).isSameAs(nested);
  }

  @Test
  void redactStringValuesReturnsTheSameMapReferenceWhenNothingChanged() {
    Map<String, Object> fields = new HashMap<>();
    fields.put("harmless", "just some text");
    assertThat(redactor.redactStringValues(fields)).isSameAs(fields);
  }

  @Test
  void redactStringValuesHandlesNullAndEmptyMaps() {
    assertThat(redactor.redactStringValues(null)).isNull();
    Map<String, Object> empty = Map.of();
    assertThat(redactor.redactStringValues(empty)).isSameAs(empty);
  }

  // ---------------------------------------------------------------------
  // helper
  // ---------------------------------------------------------------------

  private static boolean isLuhnValid(String digits) {
    int sum = 0;
    boolean doubleDigit = false;
    for (int i = digits.length() - 1; i >= 0; i--) {
      int d = digits.charAt(i) - '0';
      if (doubleDigit) {
        d *= 2;
        if (d > 9) {
          d -= 9;
        }
      }
      sum += d;
      doubleDigit = !doubleDigit;
    }
    return sum % 10 == 0;
  }
}
