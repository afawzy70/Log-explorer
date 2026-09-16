package com.logexplorer.core.classify;

import static com.logexplorer.core.classify.ClassificationTestRules.condition;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * The user-selected classification colour (owner mission "Classification
 * real search scope, assisted extraction, and visual tagging" §"Fifth owner
 * requirement"): a controlled semantic palette, a deterministic default,
 * backwards-compatible files and packs, and a same-tag conflict that is
 * reported instead of silently resolved.
 */
class TagColorTest {

  @TempDir
  Path dir;

  private Path file;
  private final Clock clock = Clock.fixed(Instant.parse("2026-09-16T10:00:00Z"), ZoneOffset.UTC);

  @BeforeEach
  void setUp() {
    file = dir.resolve("data").resolve("classification-rules.json");
  }

  private ClassificationRuleService service() {
    return new ClassificationRuleService(new ClassificationRuleRepository(file), new RuleCompiler(),
        new ClassificationEngine(new ObjectMapper()), clock);
  }

  private static ClassificationRule rule(String id, String tag, TagColor color) {
    return new ClassificationRule(id, "Rule " + id, null, List.of(tag), color, true, 100, MatchMode.ALL,
        List.of(condition("message", MatcherType.CONTAINS, "webhook")), List.of(), null, null);
  }

  @Test
  void aRuleWithNoChosenColourGetsTheSameDeterministicColourEverywhere() {
    ClassificationRule saved = service().create(0L, rule("a", "middleware", null)).document().rules().get(0);

    assertThat(saved.displayColor()).isNotNull();
    assertThat(saved.displayColor()).isEqualTo(TagColor.defaultFor("middleware"));
    assertThat(TagColor.defaultFor("MIDDLEWARE ")).isEqualTo(TagColor.defaultFor("middleware"));
    assertThat(TagColor.defaultFor(null)).isEqualTo(TagColor.GRAY);
  }

  @Test
  void anExplicitColourIsPersistedAndSurvivesAReload() {
    ClassificationRuleService service = service();
    service.create(0L, rule("a", "middleware", TagColor.BLUE));

    assertThat(service.state().document().rules().get(0).displayColor()).isEqualTo(TagColor.BLUE);
    // A brand new service over the same file reads what was actually written.
    assertThat(service().state().document().rules().get(0).displayColor()).isEqualTo(TagColor.BLUE);
  }

  @Test
  void aRulesFileWrittenBeforeColoursExistedStillLoads() throws Exception {
    Files.createDirectories(file.getParent());
    Files.writeString(file, """
        {"format":"log-explorer-classification-rules","schemaVersion":1,"revision":4,
         "rules":[{"id":"legacy","name":"Legacy","tags":["middleware"],"enabled":true,"priority":100,
                   "matchMode":"ALL",
                   "conditions":[{"field":"message","matcher":"CONTAINS","value":"webhook"}]}]}""",
        StandardCharsets.UTF_8);

    ClassificationRuleService service = service();

    assertThat(service.state().status()).isEqualTo(ConfigurationStatus.OK);
    ClassificationRule loaded = service.state().document().rules().get(0);
    assertThat(loaded.displayColor()).isNull();
    assertThat(loaded.effectiveDisplayColor()).isEqualTo(TagColor.defaultFor("middleware"));
  }

  @Test
  void twoRulesMayShareATagOnlyWhenTheyShowItInTheSameColour() {
    ClassificationRuleService service = service();
    long revision = service.create(0L, rule("a", "middleware", TagColor.BLUE)).document().revisionOrZero();

    // Same tag, same colour: allowed.
    revision = service.create(revision, rule("b", "middleware", TagColor.BLUE)).document().revisionOrZero();

    // Same tag, a different colour: refused, with a message naming the tag and the rule that already claims it.
    long stale = revision;
    assertThatThrownBy(() -> service.create(stale, rule("c", "middleware", TagColor.RED)))
        .isInstanceOf(RuleValidationException.class)
        .satisfies(e -> assertThat(((RuleValidationException) e).errors())
            .singleElement()
            .satisfies(error -> {
              assertThat(error.path()).endsWith(".displayColor");
              assertThat(error.message()).contains("middleware").contains("BLUE").contains("Rule a");
            }));
    assertThat(service.state().document().rules()).hasSize(2);
  }

  @Test
  void aPackCarriesTheColourAndAPackWithoutOneImportsWithTheDefault() {
    ClassificationRuleService service = service();
    service.create(0L, rule("a", "middleware", TagColor.PURPLE));

    String pack = new String(service.exportPackBytes(null, null), StandardCharsets.UTF_8);
    assertThat(pack).contains("\"displayColor\" : \"PURPLE\"");

    long revision = service.delete("a", service.state().document().revisionOrZero()).document().revisionOrZero();
    service.applyImport(pack.getBytes(StandardCharsets.UTF_8), ImportMode.MERGE, null, revision, false);
    assertThat(service.state().document().rules().get(0).displayColor()).isEqualTo(TagColor.PURPLE);

    String colourless = """
        {"format":"log-explorer-classification-pack","schemaVersion":1,
         "rules":[{"id":"old","name":"Old","tags":["legacy-tag"],
                   "conditions":[{"field":"message","matcher":"CONTAINS","value":"webhook"}]}]}""";
    service.applyImport(colourless.getBytes(StandardCharsets.UTF_8), ImportMode.MERGE, null,
        service.state().document().rules().isEmpty() ? 0L : service.state().document().revisionOrZero(), false);
    ClassificationRule imported = service.state().document().rules().stream()
        .filter(r -> "old".equals(r.id())).findFirst().orElseThrow();
    assertThat(imported.effectiveDisplayColor()).isEqualTo(TagColor.defaultFor("legacy-tag"));
  }

  @Test
  void anImportThatWouldGiveOneTagTwoColoursIsReportedAndRefused() {
    ClassificationRuleService service = service();
    long revision = service.create(0L, rule("a", "middleware", TagColor.BLUE)).document().revisionOrZero();
    byte[] pack = """
        {"format":"log-explorer-classification-pack","schemaVersion":1,
         "rules":[{"id":"b","name":"Imported","tags":["middleware"],"displayColor":"RED",
                   "conditions":[{"field":"message","matcher":"CONTAINS","value":"webhook"}]}]}"""
        .getBytes(StandardCharsets.UTF_8);

    ClassificationRuleService.ImportPreview preview = service.previewImport(pack);
    assertThat(preview.tagColorConflicts()).singleElement()
        .satisfies(error -> assertThat(error.message()).contains("middleware").contains("BLUE"));

    assertThatThrownBy(() -> service.applyImport(pack, ImportMode.MERGE, ConflictResolution.USE_IMPORTED, revision, false))
        .isInstanceOf(RuleValidationException.class);
    assertThat(service.state().document().rules()).singleElement()
        .satisfies(r -> assertThat(r.displayColor()).isEqualTo(TagColor.BLUE));
  }

  @Test
  void theResolvedColourOfEveryTagIsReportedForTheUi() {
    ClassificationRuleService service = service();
    long revision = service.create(0L, rule("a", "middleware", TagColor.CYAN)).document().revisionOrZero();
    service.create(revision, rule("b", "api-logs", TagColor.AMBER));

    assertThat(TagColorPolicy.tagColors(service.state().document().rules()))
        .containsEntry("middleware", TagColor.CYAN)
        .containsEntry("api-logs", TagColor.AMBER);
  }
}
