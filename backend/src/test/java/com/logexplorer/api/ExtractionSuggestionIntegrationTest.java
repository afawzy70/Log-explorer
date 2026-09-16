package com.logexplorer.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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

import com.logexplorer.core.classify.ClassificationRuleService;
import com.logexplorer.core.classify.ImportMode;

/**
 * Assisted extraction (owner mission §"Second owner requirement"): the
 * events a rule actually matches, in the user's committed search scope, are
 * mined for extractable values by the same deterministic detector Detect
 * pattern uses — no external service, nothing saved, every number measured.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class ExtractionSuggestionIntegrationTest {

  private static final Path DATA_DIR = createDataDir();
  private static final String BASE = "/api/v1/settings/classification-rules";
  private static final String API_LOGS_CONDITIONS =
      "\"conditions\":[{\"field\":\"message\",\"matcher\":\"STARTS_WITH\",\"value\":\"API_LOGS:\"}]";

  private static Path createDataDir() {
    try {
      return Files.createTempDirectory("extraction-suggestion-it");
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

  private final ObjectMapper mapper = new ObjectMapper();

  @BeforeEach
  void allowFullFixtureResponses() {
    client = client.mutate().codecs(c -> c.defaultCodecs().maxInMemorySize(8 * 1024 * 1024)).build();
  }

  @AfterEach
  void resetRules() {
    ruleService.applyImport("{\"format\":\"log-explorer-classification-pack\",\"schemaVersion\":1,\"rules\":[]}"
        .getBytes(StandardCharsets.UTF_8), ImportMode.REPLACE_ALL, null,
        ruleService.state().document().revisionOrZero(), true);
  }

  private JsonNode json(String body) {
    try {
      return mapper.readTree(body);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  private static String scope(String extraFields) {
    return "{\"sourceId\":\"fixture\",\"start\":\"" + Instant.now().minus(1, ChronoUnit.HOURS) + "\",\"end\":\""
        + Instant.now().plus(5, ChronoUnit.MINUTES) + "\"" + extraFields + "}";
  }

  private JsonNode suggest(String body) {
    return json(client.post().uri(BASE + "/extractions/suggest").contentType(MediaType.APPLICATION_JSON)
        .bodyValue(body).exchange().expectStatus().isOk().expectBody(String.class).returnResult().getResponseBody());
  }

  private String anApiLogsMessage() {
    JsonNode events = json(client.post().uri("/api/v1/logs/search").contentType(MediaType.APPLICATION_JSON)
        .bodyValue("{\"sourceId\":\"fixture\",\"start\":\"" + Instant.now().minus(1, ChronoUnit.HOURS)
            + "\",\"end\":\"" + Instant.now().plus(5, ChronoUnit.MINUTES) + "\",\"limit\":500,\"text\":\"API_LOGS\"}")
        .exchange().expectStatus().isOk().expectBody(String.class).returnResult().getResponseBody()).get("events");
    for (JsonNode event : events) {
      if (event.path("message").asText("").startsWith("API_LOGS:")) {
        return event.get("message").asText();
      }
    }
    throw new AssertionError("the fixture corpus must contain API_LOGS events");
  }

  @Test
  void suggestsExtractableValuesFromTheEventsAnUnsavedRuleMatches() {
    String anchor = anApiLogsMessage();
    JsonNode result = suggest("{\"rule\":{\"name\":\"API logs\",\"tags\":[\"api-logs\"]," + API_LOGS_CONDITIONS
        + "},\"field\":\"message\",\"anchorValue\":" + mapper.valueToTree(anchor) + ",\"scope\":"
        + scope(",\"text\":\"API_LOGS\"") + ",\"sampleSize\":40}");

    assertThat(result.get("status").asText()).isEqualTo("SUGGESTED");
    assertThat(result.get("field").asText()).isEqualTo("message");
    int matched = result.get("matchedEvents").asInt();
    assertThat(matched).isPositive();
    assertThat(result.get("sampledEvents").asInt()).isGreaterThanOrEqualTo(matched);
    assertThat(result.get("suggestions")).isNotEmpty().allSatisfy(suggestion -> {
      assertThat(suggestion.get("definition").get("name").asText()).isNotBlank();
      assertThat(suggestion.get("definition").get("sourceField").asText()).isEqualTo("message");
      assertThat(suggestion.get("of").asInt()).isEqualTo(matched);
      assertThat(suggestion.get("extracted").asInt()).isBetween(0, matched);
    });
    // The rule is only a draft: suggesting saves nothing.
    assertThat(ruleService.state().document().rules()).isEmpty();
  }

  @Test
  void suggestionsForASavedRuleSkipTheValuesItAlreadyExtracts() {
    String rule = "{\"expectedRevision\":" + ruleService.state().document().revisionOrZero()
        + ",\"rule\":{\"name\":\"API logs\",\"tags\":[\"api-logs\"]," + API_LOGS_CONDITIONS + "}}";
    JsonNode saved = json(client.post().uri(BASE).contentType(MediaType.APPLICATION_JSON).bodyValue(rule)
        .exchange().expectStatus().isOk().expectBody(String.class).returnResult().getResponseBody());
    String id = saved.get("rules").get(0).get("id").asText();
    String anchor = anApiLogsMessage();

    JsonNode first = suggest("{\"ruleId\":\"" + id + "\",\"field\":\"message\",\"anchorValue\":"
        + mapper.valueToTree(anchor) + ",\"scope\":" + scope(",\"text\":\"API_LOGS\"") + ",\"sampleSize\":40}");
    assertThat(first.get("status").asText()).isEqualTo("SUGGESTED");
    JsonNode adopted = first.get("suggestions").get(0).get("definition");

    // Save that one suggestion, then ask again: it is reported as already defined, never offered twice.
    String update = "{\"expectedRevision\":" + ruleService.state().document().revisionOrZero()
        + ",\"rule\":{\"id\":\"" + id + "\",\"name\":\"API logs\",\"tags\":[\"api-logs\"]," + API_LOGS_CONDITIONS
        + ",\"extractions\":[" + adopted + "]}}";
    client.put().uri(BASE + "/" + id).contentType(MediaType.APPLICATION_JSON).bodyValue(update)
        .exchange().expectStatus().isOk();

    JsonNode second = suggest("{\"ruleId\":\"" + id + "\",\"field\":\"message\",\"anchorValue\":"
        + mapper.valueToTree(anchor) + ",\"scope\":" + scope(",\"text\":\"API_LOGS\"") + ",\"sampleSize\":40}");
    assertThat(second.get("alreadyDefined")).extracting(JsonNode::asText).contains(adopted.get("name").asText());
    assertThat(second.get("suggestions")).noneSatisfy(suggestion ->
        assertThat(suggestion.get("definition").get("name").asText()).isEqualTo(adopted.get("name").asText()));
  }

  @Test
  void saysSoPlainlyWhenNothingCanBeSuggestedSafely() {
    JsonNode result = suggest("{\"rule\":{\"name\":\"Rate limit\",\"tags\":[\"rate-limit\"],"
        + "\"conditions\":[{\"field\":\"message\",\"matcher\":\"EXACT\",\"value\":\"Applied rate limit check\"}]},"
        + "\"field\":\"message\",\"scope\":" + scope(",\"text\":\"Applied rate limit check\"")
        + ",\"sampleSize\":40}");

    assertThat(result.get("status").asText()).isEqualTo("NO_SUGGESTION");
    assertThat(result.get("reason").asText()).isNotBlank();
    assertThat(result.get("suggestions")).isEmpty();
    assertThat(result.get("matchedEvents").asInt()).isPositive();
  }

  @Test
  void explainsRatherThanGuessesWhenTheRuleMatchesNothingInScope() {
    JsonNode result = suggest("{\"rule\":{\"name\":\"API logs\",\"tags\":[\"api-logs\"]," + API_LOGS_CONDITIONS
        + "},\"field\":\"message\",\"scope\":" + scope(",\"text\":\"no-event-says-this\"") + ",\"sampleSize\":40}");

    assertThat(result.get("status").asText()).isEqualTo("NO_SUGGESTION");
    assertThat(result.get("matchedEvents").asInt()).isZero();
    assertThat(result.get("reason").asText()).contains("nothing to infer values from");
  }

  @Test
  void aRuleThatNoLongerExistsIsRefusedInsteadOfSilentlyIgnored() {
    client.post().uri(BASE + "/extractions/suggest").contentType(MediaType.APPLICATION_JSON)
        .bodyValue("{\"ruleId\":\"gone\",\"field\":\"message\",\"scope\":" + scope("") + "}")
        .exchange().expectStatus().isBadRequest();
  }
}
