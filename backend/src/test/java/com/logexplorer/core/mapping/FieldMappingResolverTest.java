package com.logexplorer.core.mapping;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Covers mission §10 (multiple candidate paths + precedence), §25/§26 (the
 * owner-observed CIF filtering defect and its fix), and the exact
 * equivalence with {@code core.parse.LogLineParser}'s old hard-coded
 * behavior this resolver's precedence rule is designed to reproduce (see
 * {@link FieldMappingResolver}'s own javadoc).
 */
class FieldMappingResolverTest {

  @Test
  void zeroCandidatesResolvesToNull() {
    assertThat(FieldMappingResolver.resolve(Map.of("cif", "2449"), List.of())).isNull();
  }

  @Test
  void singleCandidate_missingKey_resolvesToNullNotThrow() {
    assertThat(FieldMappingResolver.resolve(Map.of(), List.of(JsonPath.parse("mdc.cif")))).isNull();
  }

  @Test
  void singleCandidate_explicitEmptyString_isReturnedAsIs_matchingOldAsStringBehavior() {
    // The old LogLineParser's asString(mdc.get(x)) never treated "" as absent for a
    // single-candidate field - this must still hold for the generalized N=1 case.
    Map<String, Object> root = Map.of("traceId", "");
    assertThat(FieldMappingResolver.resolve(root, List.of(JsonPath.parse("traceId")))).isEmpty();
  }

  // --- The owner-observed defect and its fix (mission §17/§26) --------------

  @Test
  void topLevelCifIsFoundWhenMappedToTopLevelPath_theOwnerObservedDefectFixed() {
    Map<String, Object> root = Map.of("cif", "2449");
    List<JsonPath> mapping = List.of(JsonPath.parse("cif"));
    assertThat(FieldMappingResolver.resolve(root, mapping)).isEqualTo("2449");
  }

  @Test
  void topLevelCifIsNotFoundWhenOnlyMdcCifIsMapped_reproducesTheOriginalDefect() {
    // This is the exact shape of the owner's bug report: cif lives at the
    // top level, but the profile (like the OLD hard-coded parser) only
    // looks under mdc.cif - so it correctly resolves to null, proving the
    // defect was real and is purely a mapping-configuration matter now,
    // not a code bug.
    Map<String, Object> root = Map.of("cif", "2449");
    List<JsonPath> mapping = List.of(JsonPath.parse("mdc.cif"));
    assertThat(FieldMappingResolver.resolve(root, mapping)).isNull();
  }

  @Test
  void cifIdAlternativePathIsUsableAsACandidate() {
    Map<String, Object> root = Map.of("cifId", "2449");
    List<JsonPath> mapping = List.of(JsonPath.parse("mdc.cif"), JsonPath.parse("cifId"));
    assertThat(FieldMappingResolver.resolve(root, mapping)).isEqualTo("2449");
  }

  @Test
  void nestedCustomerCifIsUsableAsACandidate() {
    Map<String, Object> root = mapOf("customer", mapOf("cif", "2449"));
    List<JsonPath> mapping = List.of(JsonPath.parse("mdc.cif"), JsonPath.parse("cif"), JsonPath.parse("customer.cif"));
    assertThat(FieldMappingResolver.resolve(root, mapping)).isEqualTo("2449");
  }

  // --- Precedence semantics (mission §10) ------------------------------------

  @Test
  void firstUsableNonNullCandidateWins_earlierCandidatePreferredOverLater() {
    Map<String, Object> root = mapOf("mdc", mapOf("cif", "from-mdc"), "cifId", "from-cifId");
    List<JsonPath> mapping = List.of(JsonPath.parse("mdc.cif"), JsonPath.parse("cifId"));
    assertThat(FieldMappingResolver.resolve(root, mapping)).isEqualTo("from-mdc");
  }

  @Test
  void nullFirstCandidate_populatedSecondCandidate_secondWins() {
    Map<String, Object> root = Map.of("cifId", "from-cifId");
    List<JsonPath> mapping = List.of(JsonPath.parse("mdc.cif"), JsonPath.parse("cifId"));
    assertThat(FieldMappingResolver.resolve(root, mapping)).isEqualTo("from-cifId");
  }

  @Test
  void emptyStringFirstCandidate_isSkippedInFavorOfPopulatedSecond() {
    Map<String, Object> root = mapOf("mdc", mapOf("cif", ""), "cifId", "2449");
    List<JsonPath> mapping = List.of(JsonPath.parse("mdc.cif"), JsonPath.parse("cifId"));
    assertThat(FieldMappingResolver.resolve(root, mapping)).isEqualTo("2449");
  }

  @Test
  void allCandidatesMissing_lastCandidateResultReturnedAsIs_null() {
    List<JsonPath> mapping = List.of(JsonPath.parse("mdc.cif"), JsonPath.parse("cifId"), JsonPath.parse("customer.cif"));
    assertThat(FieldMappingResolver.resolve(Map.of(), mapping)).isNull();
  }

  @Test
  void threeCandidates_thirdWinsWhenFirstTwoAreEmptyOrMissing() {
    Map<String, Object> root = mapOf("customer", mapOf("cif", "2449"));
    List<JsonPath> mapping = List.of(JsonPath.parse("mdc.cif"), JsonPath.parse("cifId"), JsonPath.parse("customer.cif"));
    assertThat(FieldMappingResolver.resolve(root, mapping)).isEqualTo("2449");
  }

  // --- Correlation ID default resolution (owner mission "Service Filter,
  //     Docker Performance, and Verified Default Mapping" §C - supersedes
  //     this section's original "reproduces the OLD two-candidate
  //     precedence" coverage; the built-in default is now a single
  //     top-level candidate, CLAUDE.md §5 named conflict, applied) --------

  @Test
  void defaultCorrelationIdResolvesTheOwnerApprovedTopLevelKey() {
    Map<String, Object> root = mapOf("X-Correlation-id", "header-corr");
    FieldMappingProfile profile = DefaultFieldMappingProfile.build();
    assertThat(FieldMappingResolver.resolve(root, profile.candidates(CanonicalField.CORRELATION_ID)))
        .isEqualTo("header-corr");
  }

  @Test
  void defaultCorrelationIdIsNullWhenTheApprovedKeyIsAbsent() {
    FieldMappingProfile profile = DefaultFieldMappingProfile.build();
    assertThat(FieldMappingResolver.resolve(Map.of(), profile.candidates(CanonicalField.CORRELATION_ID))).isNull();
  }

  /**
   * The OLD two-candidate precedence (header-shaped key first, literal
   * dotted-key fallback second) is no longer the built-in default, but
   * the resolver mechanism that made it work is unchanged and remains
   * available to anyone who explicitly configures it this way (see {@code
   * LogLineParserTest.literalDottedKeyFallbackRemainsAvailableAsAnExplicitlyConfiguredCandidate}
   * for the same proof at the full-parse level).
   */
  @Test
  void twoCandidateHeaderThenLiteralDottedKeyPrecedenceRemainsAvailableWhenExplicitlyConfigured() {
    List<JsonPath> explicitTwoCandidatePrecedence = List.of(
        JsonPath.parse("mdc.X-Correlation-id"),
        JsonPath.parse("mdc[\"event.correlationId\"]"));

    Map<String, Object> bothPresent = mapOf("mdc", mapOf("X-Correlation-id", "header-corr", "event.correlationId", "literal-corr"));
    assertThat(FieldMappingResolver.resolve(bothPresent, explicitTwoCandidatePrecedence)).isEqualTo("header-corr");

    Map<String, Object> onlyLiteralPresent = mapOf("mdc", mapOf("event.correlationId", "literal-corr"));
    assertThat(FieldMappingResolver.resolve(onlyLiteralPresent, explicitTwoCandidatePrecedence)).isEqualTo("literal-corr");

    assertThat(FieldMappingResolver.resolve(Map.of(), explicitTwoCandidatePrecedence)).isNull();
  }

  // --- Provenance (mission §16 validation preview) ---------------------------

  @Test
  void resolveWithProvenanceReportsWhichCandidateSuppliedTheValue() {
    Map<String, Object> root = Map.of("cifId", "2449");
    List<JsonPath> mapping = List.of(JsonPath.parse("mdc.cif"), JsonPath.parse("cifId"));
    FieldMappingResolver.ResolvedField result = FieldMappingResolver.resolveWithProvenance(root, mapping);
    assertThat(result.value()).isEqualTo("2449");
    assertThat(result.sourcePath()).isEqualTo(JsonPath.parse("cifId"));
  }

  @Test
  void resolveWithProvenance_noCandidateResolves_sourcePathIsNull() {
    List<JsonPath> mapping = List.of(JsonPath.parse("mdc.cif"));
    FieldMappingResolver.ResolvedField result = FieldMappingResolver.resolveWithProvenance(Map.of(), mapping);
    assertThat(result.value()).isNull();
    assertThat(result.sourcePath()).isNull();
  }

  // --- resolveAll (full-event resolution, what LogLineParser calls) ----------

  @Test
  void resolveAllProducesAnEntryForEveryCanonicalField() {
    FieldMappingProfile profile = DefaultFieldMappingProfile.build();
    Map<CanonicalField, String> resolved = FieldMappingResolver.resolveAll(Map.of(), profile);
    assertThat(resolved).containsOnlyKeys(CanonicalField.values());
  }

  @Test
  void journeyNameIsNullByDefault_noVerifiedDefaultMappingYet() {
    FieldMappingProfile profile = DefaultFieldMappingProfile.build();
    Map<String, Object> root = mapOf("mdc", mapOf("journeyName", "SIGN_IN"));
    Map<CanonicalField, String> resolved = FieldMappingResolver.resolveAll(root, profile);
    assertThat(resolved.get(CanonicalField.JOURNEY_NAME)).isNull();
  }

  @Test
  void journeyNameResolvesOnceMappedByTheUser() {
    FieldMappingProfile profile = DefaultFieldMappingProfile.build()
        .withCandidates(CanonicalField.JOURNEY_NAME, List.of(JsonPath.parse("mdc.journeyName")));
    Map<String, Object> root = mapOf("mdc", mapOf("journeyName", "SIGN_IN"));
    Map<CanonicalField, String> resolved = FieldMappingResolver.resolveAll(root, profile);
    assertThat(resolved.get(CanonicalField.JOURNEY_NAME)).isEqualTo("SIGN_IN");
  }

  @SafeVarargs
  private static Map<String, Object> mapOf(Object... kv) {
    Map<String, Object> m = new LinkedHashMap<>();
    for (int i = 0; i < kv.length; i += 2) {
      m.put((String) kv[i], kv[i + 1]);
    }
    return m;
  }
}
