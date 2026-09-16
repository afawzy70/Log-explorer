package com.logexplorer.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.logexplorer.core.classify.ClassificationRuleService;
import com.logexplorer.core.classify.ImportMode;
import com.logexplorer.core.mask.MaskingPolicyService;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.reactive.server.WebTestClient;

/**
 * End-to-end over real HTTP against the deterministic Fixture source, whose
 * lines go through the real {@code LogLineParser} — the same path every
 * adapter uses. The rules file lives in an isolated temporary directory.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class ClassificationRulesIntegrationTest {

  private static final Path DATA_DIR = createDataDir();
  private static final String BASE = "/api/v1/settings/classification-rules";

  private static Path createDataDir() {
    try {
      return Files.createTempDirectory("classification-it");
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  @DynamicPropertySource
  static void rulesFile(DynamicPropertyRegistry registry) {
    registry.add("logexplorer.classification.rules-file", () -> DATA_DIR.resolve("classification-rules.json").toString());
  }

  @Autowired
  private WebTestClient client;

  @Autowired
  private ClassificationRuleService ruleService;

  @Autowired
  private MaskingPolicyService maskingPolicy;

  private final ObjectMapper mapper = new ObjectMapper();

  @BeforeEach
  void allowFullFixtureResponses() {
    client = client.mutate().codecs(c -> c.defaultCodecs().maxInMemorySize(8 * 1024 * 1024)).build();
  }

  @AfterEach
  void resetRules() {
    long revision = ruleService.state().document().revisionOrZero();
    ruleService.applyImport("{\"format\":\"log-explorer-classification-pack\",\"schemaVersion\":1,\"rules\":[]}"
        .getBytes(StandardCharsets.UTF_8), ImportMode.REPLACE_ALL, null, revision, true);
    maskingPolicy.resetToDefaults();
  }

  private static final String MIDDLEWARE_RULE = """
      {"name":"Middleware HTTP Call","tags":["middleware"],
       "conditions":[{"field":"message","matcher":"STARTS_WITH","value":"Make webhook call to"},
                     {"field":"message","matcher":"CONTAINS","value":"responseCode="}],
       "extractions":[{"name":"url","label":"URL","sourceField":"message","type":"REGEX","expression":"\\\\bto\\\\s+(?P<url>\\\\S+)"},
                      {"name":"responseCode","label":"Response code","sourceField":"message","type":"REGEX","expression":"responseCode=(?P<responseCode>\\\\d+)","valueType":"INTEGER"},
                      {"name":"durationMs","label":"Duration (ms)","sourceField":"message","type":"REGEX","expression":"duration=(?P<durationMs>\\\\d+)ms","valueType":"INTEGER"},
                      {"name":"requestBody","sourceField":"message","type":"REGEX","expression":"body=(?P<requestBody>\\\\S+)"}]}""";

  private JsonNode state() {
    return json(client.get().uri(BASE).exchange().expectStatus().isOk().expectBody(String.class).returnResult().getResponseBody());
  }

  private JsonNode json(String body) {
    try {
      return mapper.readTree(body);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  private JsonNode createRule(String ruleJson) {
    long revision = state().get("revision").asLong();
    return json(client.post().uri(BASE).contentType(MediaType.APPLICATION_JSON)
        .bodyValue("{\"expectedRevision\":" + revision + ",\"rule\":" + ruleJson + "}")
        .exchange().expectStatus().isOk().expectBody(String.class).returnResult().getResponseBody());
  }

  private String scope() {
    Instant now = Instant.now();
    return "{\"sourceId\":\"fixture\",\"start\":\"" + now.minus(1, ChronoUnit.HOURS) + "\",\"end\":\""
        + now.plus(5, ChronoUnit.MINUTES) + "\"}";
  }

  private JsonNode search(String extraFields) {
    Instant now = Instant.now();
    String body = "{\"sourceId\":\"fixture\",\"start\":\"" + now.minus(1, ChronoUnit.HOURS) + "\",\"end\":\""
        + now.plus(5, ChronoUnit.MINUTES) + "\",\"limit\":500" + extraFields + "}";
    return json(client.post().uri("/api/v1/logs/search").contentType(MediaType.APPLICATION_JSON).bodyValue(body)
        .exchange().expectStatus().isOk().expectBody(String.class).returnResult().getResponseBody());
  }

  @Test
  void savedRuleClassifiesFutureSearchesWithExtractedValuesAndNeverTagsSimilarNonMatches() {
    assertThat(search("").get("events")).allSatisfy(e -> assertThat(e.get("tags")).isEmpty());

    JsonNode saved = createRule(MIDDLEWARE_RULE);
    assertThat(saved.get("rules")).hasSize(1);
    assertThat(saved.get("status").asText()).isEqualTo("OK");
    assertThat(Files.exists(DATA_DIR.resolve("classification-rules.json"))).isTrue();

    JsonNode events = search("").get("events");
    int middleware = 0;
    for (JsonNode event : events) {
      String message = event.path("message").asText("");
      if (message.startsWith("Make webhook call to")) {
        middleware++;
        assertThat(event.get("tags")).extracting(JsonNode::asText).containsExactly("middleware");
        JsonNode classification = event.get("classifications").get(0);
        assertThat(classification.get("ruleName").asText()).isEqualTo("Middleware HTTP Call");
        JsonNode extracted = classification.get("extracted");
        assertThat(extracted.get(0).get("value").asText()).startsWith("/");
        assertThat(extracted.get(1).get("value").asText()).matches("\\d{3}");
        assertThat(extracted.get(2).get("value").asText()).matches("\\d+");
        assertThat(extracted.get(3).get("status").asText()).isEqualTo("ABSENT");
        assertThat(extracted.get(3).get("value").isNull()).isTrue();
      } else {
        assertThat(event.get("tags")).as(message).isEmpty();
      }
    }
    assertThat(middleware).isGreaterThan(10);
  }

  @Test
  void tagFilterIsEnforcedByTheBackendWithAnySemantics() {
    createRule(MIDDLEWARE_RULE);
    JsonNode tagged = search(",\"tags\":[\"Middleware\",\"not-a-real-tag\"]");
    assertThat(tagged.get("events")).isNotEmpty()
        .allSatisfy(e -> assertThat(e.get("tags")).extracting(JsonNode::asText).contains("middleware"));
    assertThat(tagged.get("queryPlan").toString()).contains("tag in [middleware, not-a-real-tag]");
    assertThat(search(",\"tags\":[\"not-a-real-tag\"]").get("events")).isEmpty();
  }

  @Test
  void deletingTheRuleRemovesClassificationFromSubsequentSearches() {
    JsonNode saved = createRule(MIDDLEWARE_RULE);
    String id = saved.get("rules").get(0).get("id").asText();
    client.delete().uri(BASE + "/" + id + "?expectedRevision=" + saved.get("revision").asLong())
        .exchange().expectStatus().isOk();
    assertThat(search(",\"text\":\"Make webhook call\"").get("events"))
        .isNotEmpty().allSatisfy(e -> assertThat(e.get("tags")).isEmpty());
  }

  @Test
  void detectSuggestsFromARealBoundedSampleAndPersistsNothing() {
    JsonNode anchorEvent = search(",\"text\":\"Make webhook call to\"").get("events").get(0);
    long revision = state().get("revision").asLong();
    String body = "{\"field\":\"message\",\"anchorValue\":" + anchorEvent.get("message") + ",\"scope\":" + scope()
        + ",\"sampleSize\":200}";
    JsonNode result = json(client.post().uri(BASE + "/detect").contentType(MediaType.APPLICATION_JSON).bodyValue(body)
        .exchange().expectStatus().isOk().expectBody(String.class).returnResult().getResponseBody());

    assertThat(result.get("status").asText()).isEqualTo("SUGGESTED");
    assertThat(result.get("sampledEvents").asInt()).isEqualTo(200);
    assertThat(result.get("similarEvents").asInt()).isBetween(3, 200);
    assertThat(result.get("suggestedConditions").get(0).get("matcher").asText()).isEqualTo("STARTS_WITH");
    assertThat(result.get("suggestedConditions").get(0).get("value").asText()).isEqualTo("Make webhook call to");
    assertThat(result.get("suggestedExtractions").findValuesAsText("name")).contains("url", "responseCode", "durationMs");
    assertThat(state().get("revision").asLong()).isEqualTo(revision);
  }

  @Test
  void ruleTestReportsBoundedResultsAndDoesNotPersistOrActivate() {
    long revision = state().get("revision").asLong();
    String body = "{\"rule\":" + MIDDLEWARE_RULE + ",\"scope\":" + scope() + ",\"sampleSize\":200}";
    JsonNode result = json(client.post().uri(BASE + "/test").contentType(MediaType.APPLICATION_JSON).bodyValue(body)
        .exchange().expectStatus().isOk().expectBody(String.class).returnResult().getResponseBody());
    assertThat(result.get("sampledEvents").asInt()).isEqualTo(200);
    assertThat(result.get("matched").asInt()).isPositive();
    assertThat(result.get("matched").asInt() + result.get("notMatched").asInt()).isEqualTo(200);
    assertThat(result.get("matchedPreview").size()).isLessThanOrEqualTo(5);
    assertThat(result.get("extractionCoverage").get(1).get("extracted").asInt()).isEqualTo(result.get("matched").asInt());
    assertThat(state().get("revision").asLong()).isEqualTo(revision);
    assertThat(search(",\"text\":\"Make webhook call\"").get("events")).allSatisfy(e -> assertThat(e.get("tags")).isEmpty());
  }

  @Test
  void staleRevisionIs409AndInvalidRuleIs400WithFieldErrors() {
    long current = createRule(MIDDLEWARE_RULE).get("revision").asLong();
    client.post().uri(BASE).contentType(MediaType.APPLICATION_JSON)
        .bodyValue("{\"expectedRevision\":" + (current - 1) + ",\"rule\":"
            + MIDDLEWARE_RULE.replace("Middleware HTTP Call", "Other") + "}")
        .exchange().expectStatus().isEqualTo(409)
        .expectBody().jsonPath("$.reason").isEqualTo("RULES_REVISION_CONFLICT")
        .jsonPath("$.currentRevision").isEqualTo((int) current);

    long revision = state().get("revision").asLong();
    client.post().uri(BASE).contentType(MediaType.APPLICATION_JSON)
        .bodyValue("{\"expectedRevision\":" + revision + ",\"rule\":{\"name\":\"Bad\",\"tags\":[\"t\"],\"conditions\":"
            + "[{\"field\":\"message\",\"matcher\":\"REGEX\",\"value\":\"(\\\\w)\\\\1\"}]}}")
        .exchange().expectStatus().isBadRequest()
        .expectBody().jsonPath("$.reason").isEqualTo("RULE_INVALID").jsonPath("$.errors[0].path").isEqualTo("conditions[0].value");
  }

  @Test
  void exportPreviewAndApplyOverHttpUseTheSamePortableFormat() {
    createRule(MIDDLEWARE_RULE);
    String pack = client.get().uri(BASE + "/export").exchange().expectStatus().isOk()
        .expectHeader().valueMatches("Content-Disposition", ".*log-explorer-classification-pack\\.json.*")
        .expectBody(String.class).returnResult().getResponseBody();
    assertThat(pack).contains("\"format\" : \"log-explorer-classification-pack\"").doesNotContain("revision", DATA_DIR.toString());

    client.post().uri(BASE + "/import/preview").contentType(MediaType.TEXT_PLAIN).bodyValue(pack)
        .exchange().expectStatus().isOk()
        .expectBody().jsonPath("$.rulesInPack").isEqualTo(1).jsonPath("$.identical").isEqualTo(1);

    long revision = state().get("revision").asLong();
    client.post().uri(BASE + "/import/apply").contentType(MediaType.APPLICATION_JSON)
        .bodyValue("{\"packJson\":" + quote(pack) + ",\"mode\":\"REPLACE_ALL\",\"expectedRevision\":" + revision + "}")
        .exchange().expectStatus().isBadRequest()
        .expectBody().jsonPath("$.reason").isEqualTo("IMPORT_REPLACE_NOT_CONFIRMED");

    client.post().uri(BASE + "/import/preview").contentType(MediaType.TEXT_PLAIN).bodyValue("{ nope")
        .exchange().expectStatus().isBadRequest().expectBody().jsonPath("$.reason").isEqualTo("IMPORT_INVALID_JSON");
  }

  private String quote(String text) {
    try {
      return mapper.writeValueAsString(text);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  @Test
  void extractedValuesNeverCarryRawSecretsToTheBrowser() {
    createRule("""
        {"name":"Login failure detail","tags":["auth-failure"],
         "conditions":[{"field":"message","matcher":"STARTS_WITH","value":"Login failed for"}],
         "extractions":[{"name":"detail","sourceField":"message","type":"REGEX","expression":"Login failed for (?P<detail>.*)"},
                        {"name":"stack","sourceField":"exception","type":"REGEX","expression":"(?s)(?P<stack>.*)"}]}""");
    String body = client.post().uri("/api/v1/logs/search").contentType(MediaType.APPLICATION_JSON)
        .bodyValue("{\"sourceId\":\"fixture\",\"start\":\"" + Instant.now().minus(1, ChronoUnit.HOURS) + "\",\"end\":\""
            + Instant.now().plus(5, ChronoUnit.MINUTES) + "\",\"limit\":500,\"tags\":[\"auth-failure\"]}")
        .exchange().expectStatus().isOk().expectBody(String.class).returnResult().getResponseBody();
    JsonNode events = json(body).get("events");
    assertThat(events).isNotEmpty();
    assertThat(body).doesNotContain("FixtureSecret123!", "eyJhbGciOiJIUzI1NiJ9", "4111 1111 1111 1111",
        "DEMO-SENSITIVE-778899");
    assertThat(events.get(0).get("classifications").get(0).get("extracted").get(0).get("redacted").asBoolean()).isTrue();
  }
}
