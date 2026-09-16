package com.logexplorer.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
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
 * The owner-reported defect, end to end over real HTTP against the
 * deterministic Fixture source: a search narrowed by free text shows many
 * matching events, but Detect pattern reported "about one similar event"
 * and a hand-written {@code message STARTS_WITH "API_LOGS:"} rule reported
 * "matched 1, not matched 199".
 *
 * <p>Cause: the classification sample was rebuilt from source, project,
 * window, services and severities only — the committed query and every
 * advanced filter were dropped, so the sample was the newest N events of
 * the whole source rather than the population the selected event was
 * visible in. These tests pin the corrected behaviour <em>and</em> the
 * contrast with the old scope, so the regression cannot come back
 * unnoticed.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class ClassificationSearchScopeIntegrationTest {

  private static final Path DATA_DIR = createDataDir();
  private static final String BASE = "/api/v1/settings/classification-rules";
  /**
   * Deliberately far smaller than the corpus so "the newest N events of the source" and "the newest N events of
   * this search" are genuinely different populations — the same shape as the owner's real 200-of-many case.
   */
  private static final int SAMPLE_SIZE = 20;

  private static final String API_LOGS_RULE = """
      {"name":"API logs","tags":["api-logs"],
       "conditions":[{"field":"message","matcher":"STARTS_WITH","value":"API_LOGS:"}]}""";

  private static Path createDataDir() {
    try {
      return Files.createTempDirectory("classification-scope-it");
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

  private final ObjectMapper mapper = new ObjectMapper();

  @BeforeEach
  void allowFullFixtureResponses() {
    client = client.mutate().codecs(c -> c.defaultCodecs().maxInMemorySize(8 * 1024 * 1024)).build();
  }

  private JsonNode json(String body) {
    try {
      return mapper.readTree(body);
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  private static Instant start() {
    return Instant.now().minus(1, ChronoUnit.HOURS);
  }

  private static Instant end() {
    return Instant.now().plus(5, ChronoUnit.MINUTES);
  }

  /** The scope the UI now sends: the committed search itself. */
  private static String scope(String extraFields) {
    return "{\"sourceId\":\"fixture\",\"start\":\"" + start() + "\",\"end\":\"" + end() + "\"" + extraFields + "}";
  }

  private JsonNode post(String path, String body) {
    return json(client.post().uri(BASE + path).contentType(MediaType.APPLICATION_JSON).bodyValue(body)
        .exchange().expectStatus().isOk().expectBody(String.class).returnResult().getResponseBody());
  }

  private JsonNode search(String extraFields) {
    String body = "{\"sourceId\":\"fixture\",\"start\":\"" + start() + "\",\"end\":\"" + end()
        + "\",\"limit\":500" + extraFields + "}";
    return json(client.post().uri("/api/v1/logs/search").contentType(MediaType.APPLICATION_JSON).bodyValue(body)
        .exchange().expectStatus().isOk().expectBody(String.class).returnResult().getResponseBody());
  }

  /** The newest real API_LOGS event - never the deliberately similar API_LOGS_SUMMARY line. */
  private static String firstApiLogsMessage(JsonNode events) {
    for (JsonNode event : events) {
      String message = event.path("message").asText("");
      if (message.startsWith("API_LOGS:")) {
        return message;
      }
    }
    throw new AssertionError("the fixture corpus must contain API_LOGS events");
  }

  private static int countApiLogs(JsonNode events) {
    int n = 0;
    for (JsonNode event : events) {
      if (event.path("message").asText("").startsWith("API_LOGS:")) {
        n++;
      }
    }
    return n;
  }

  @Test
  void detectSamplesTheSameSearchPopulationTheSelectedEventCameFrom() {
    JsonNode visible = search(",\"text\":\"API_LOGS\"").get("events");
    int visibleApiLogs = countApiLogs(visible);
    assertThat(visibleApiLogs)
        .as("the corpus must hold many API_LOGS events for this defect to be reproducible")
        .isGreaterThan(SAMPLE_SIZE);
    String anchor = firstApiLogsMessage(visible);

    JsonNode withQuery = post("/detect", "{\"field\":\"message\",\"anchorValue\":" + mapper.valueToTree(anchor)
        + ",\"scope\":" + scope(",\"text\":\"API_LOGS\"") + ",\"sampleSize\":" + SAMPLE_SIZE + "}");
    assertThat(withQuery.get("status").asText()).isEqualTo("SUGGESTED");
    assertThat(withQuery.get("sampledEvents").asInt()).isEqualTo(SAMPLE_SIZE);
    assertThat(withQuery.get("similarEvents").asInt())
        .as("almost every event of an API_LOGS search is similar to an API_LOGS event")
        .isGreaterThanOrEqualTo(SAMPLE_SIZE / 2);
    assertThat(withQuery.get("suggestedConditions").get(0).get("value").asText()).startsWith("API_LOGS");

    // The defect: the same call with the pre-fix scope (no query) samples the newest events of the whole source.
    JsonNode withoutQuery = post("/detect", "{\"field\":\"message\",\"anchorValue\":" + mapper.valueToTree(anchor)
        + ",\"scope\":" + scope("") + ",\"sampleSize\":" + SAMPLE_SIZE + "}");
    assertThat(withoutQuery.get("similarEvents").asInt())
        .as("evidence of the reported defect: an unscoped sample barely sees the population on screen")
        .isLessThan(withQuery.get("similarEvents").asInt());
  }

  @Test
  void testRuleMatchesTheVisiblePopulationInsteadOfOneStrayEvent() {
    JsonNode scoped = post("/test", "{\"rule\":" + API_LOGS_RULE + ",\"scope\":"
        + scope(",\"text\":\"API_LOGS\"") + ",\"sampleSize\":" + SAMPLE_SIZE + "}");
    assertThat(scoped.get("sampledEvents").asInt()).isEqualTo(SAMPLE_SIZE);
    assertThat(scoped.get("matched").asInt() + scoped.get("notMatched").asInt()).isEqualTo(SAMPLE_SIZE);
    assertThat(scoped.get("matched").asInt())
        .as("an API_LOGS search is mostly API_LOGS events, so the rule must match most of the sample")
        .isGreaterThanOrEqualTo(SAMPLE_SIZE / 2);
    assertThat(scoped.get("sampleLimitReached").asBoolean()).isTrue();

    JsonNode unscoped = post("/test", "{\"rule\":" + API_LOGS_RULE + ",\"scope\":" + scope("")
        + ",\"sampleSize\":" + SAMPLE_SIZE + "}");
    assertThat(unscoped.get("matched").asInt())
        .as("the reported symptom: an unscoped sample reports almost no matches for a screen full of them")
        .isLessThan(scoped.get("matched").asInt());
  }

  @Test
  void everyCommittedFilterNarrowsTheSampleTheSameWaySearchDoes() {
    // Service + severity + free text together, exactly as they would arrive from the toolbar.
    String narrow = ",\"text\":\"API_LOGS\",\"services\":[\"gateway\"],\"serviceFilterMode\":\"INCLUDE\","
        + "\"levels\":[\"INFO\",\"WARN\"]";
    JsonNode visible = search(narrow).get("events");
    assertThat(visible).isNotEmpty();
    JsonNode result = post("/test", "{\"rule\":" + API_LOGS_RULE + ",\"scope\":" + scope(narrow)
        + ",\"sampleSize\":" + SAMPLE_SIZE + "}");
    int sampled = result.get("sampledEvents").asInt();
    assertThat(sampled).isLessThanOrEqualTo(Math.min(SAMPLE_SIZE, visible.size()));
    assertThat(result.get("matchedPreview")).allSatisfy(preview ->
        assertThat(preview.get("service").asText()).isEqualTo("gateway"));

    // A filter that excludes the whole population leaves an honestly empty sample, never a silently broader one.
    JsonNode excluded = post("/test", "{\"rule\":" + API_LOGS_RULE + ",\"scope\":"
        + scope(",\"text\":\"API_LOGS\",\"services\":[\"gateway\"],\"serviceFilterMode\":\"EXCLUDE\"")
        + ",\"sampleSize\":" + SAMPLE_SIZE + "}");
    assertThat(excluded.get("matched").asInt()).isZero();
  }

  @Test
  void identifierFiltersReachTheSampleToo() {
    JsonNode events = search(",\"text\":\"API_LOGS\"").get("events");
    JsonNode event = null;
    for (JsonNode candidate : events) {
      if (candidate.path("message").asText("").startsWith("API_LOGS:")) {
        event = candidate;
        break;
      }
    }
    assertThat(event).isNotNull();
    String traceId = event.get("traceId").asText();
    assertThat(traceId).isNotBlank();
    JsonNode result = post("/test", "{\"rule\":" + API_LOGS_RULE + ",\"scope\":"
        + scope(",\"traceId\":\"" + traceId + "\"") + ",\"sampleSize\":" + SAMPLE_SIZE + "}");
    assertThat(result.get("sampledEvents").asInt())
        .as("one trace is a tiny population - the sample must shrink to it")
        .isLessThan(SAMPLE_SIZE);
    assertThat(result.get("sampledEvents").asInt()).isPositive();
  }

  @Test
  void theSelectedEventTakesPartEvenWhenTheBoundedPageStopsShortOfIt() {
    JsonNode apiLogs = search(",\"text\":\"API_LOGS\"").get("events");
    JsonNode oldest = null;
    for (JsonNode event : apiLogs) {
      if (event.path("message").asText("").startsWith("API_LOGS:")) {
        oldest = event;
      }
    }
    assertThat(oldest).isNotNull();
    String anchorTimestamp = oldest.get("timestamp").asText();
    String anchorMessage = oldest.get("message").asText();

    String tinyScope = "{\"sourceId\":\"fixture\",\"start\":\"" + start() + "\",\"end\":\"" + end()
        + "\",\"text\":\"API_LOGS\",\"anchorTimestamp\":\"" + anchorTimestamp + "\"}";
    JsonNode result = post("/detect", "{\"field\":\"message\",\"anchorValue\":" + mapper.valueToTree(anchorMessage)
        + ",\"scope\":" + tinyScope + ",\"sampleSize\":3}");

    assertThat(result.get("sampledEvents").asInt())
        .as("the three newest events plus the anchor that fell outside them")
        .isEqualTo(4);
  }

  @Test
  void aSampleWithoutAnAnchorTimestampStaysExactlyTheRequestedSize() {
    JsonNode result = post("/test", "{\"rule\":" + API_LOGS_RULE + ",\"scope\":" + scope(",\"text\":\"API_LOGS\"")
        + ",\"sampleSize\":3}");
    assertThat(result.get("sampledEvents").asInt()).isEqualTo(3);
  }

  @Test
  void aClassificationTagFilterIsNeverCarriedIntoASample() {
    // Tags exist only after classification by the saved rules, so sampling through them while authoring a rule
    // would make the evidence depend on the classification being created. Every other filter is preserved.
    JsonNode result = post("/test", "{\"rule\":" + API_LOGS_RULE + ",\"scope\":"
        + scope(",\"text\":\"API_LOGS\",\"tags\":[\"no-such-tag\"]") + ",\"sampleSize\":" + SAMPLE_SIZE + "}");
    assertThat(result.get("sampledEvents").asInt()).isEqualTo(SAMPLE_SIZE);
    assertThat(result.get("matched").asInt()).isPositive();
  }
}
