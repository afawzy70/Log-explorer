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
  void everyImportPreviewItemCarriesThePackRulesOwnColourNeverTheExistingRulesColour() {
    // Owner mission §22.11 A12: the preview draws each pack row in the colour that rule ITSELF would bring, so a
    // reviewer can judge it before deciding - never the colour of whatever it happens to conflict/match with.
    ClassificationRuleService service = service();
    long revision = service.create(0L, rule("a", "middleware", TagColor.BLUE)).document().revisionOrZero();
    byte[] pack = """
        {"format":"log-explorer-classification-pack","schemaVersion":1,
         "rules":[
           {"id":"b","name":"New rule","tags":["fresh"],"displayColor":"AMBER",
            "conditions":[{"field":"message","matcher":"CONTAINS","value":"x"}]},
           {"id":"a","name":"Rule a","tags":["middleware"],"displayColor":"BLUE",
            "conditions":[{"field":"message","matcher":"CONTAINS","value":"webhook"}]},
           {"id":"c","name":"Bad rule","tags":[],
            "conditions":[{"field":"message","matcher":"REGEX","value":"(\\\\w)\\\\1"}]},
           {"id":"d","name":"Unparseable","tags":["x"],"matchMode":"NOT_A_REAL_MODE",
            "conditions":[{"field":"message","matcher":"EXACT","value":"z"}]}
         ]}"""
        .getBytes(StandardCharsets.UTF_8);

    ClassificationRuleService.ImportPreview preview = service.previewImport(pack);
    assertThat(preview.items()).hasSize(4);

    var newItem = preview.items().stream().filter(i -> "b".equals(i.id())).findFirst().orElseThrow();
    assertThat(newItem.status()).isEqualTo(ClassificationRuleService.ImportItem.Status.NEW);
    assertThat(newItem.displayColor()).isEqualTo(TagColor.AMBER);

    var identicalItem = preview.items().stream().filter(i -> "a".equals(i.id())).findFirst().orElseThrow();
    assertThat(identicalItem.status()).isEqualTo(ClassificationRuleService.ImportItem.Status.IDENTICAL);
    // Same colour as the existing rule here, but that is coincidence (the pack said BLUE too) - not the server
    // substituting the existing rule's colour; verified against a pack that disagrees below.
    assertThat(identicalItem.displayColor()).isEqualTo(TagColor.BLUE);

    // Parseable but invalid (a real rule object, just failing validation - empty tags): still gets the
    // deterministic default for its (empty) tag list, GRAY - never an invented colour, never omitted.
    var invalidButParseableItem = preview.items().stream().filter(i -> "c".equals(i.id())).findFirst().orElseThrow();
    assertThat(invalidButParseableItem.status()).isEqualTo(ClassificationRuleService.ImportItem.Status.INVALID);
    assertThat(invalidButParseableItem.displayColor()).isEqualTo(TagColor.GRAY);

    // Genuinely unparseable (an invalid enum value - no rule object could be built at all): no colour to report,
    // correctly null rather than a guessed default.
    var unparseableItem = preview.items().stream()
        .filter(i -> i.id() == null && i.status() == ClassificationRuleService.ImportItem.Status.INVALID)
        .findFirst().orElseThrow();
    assertThat(unparseableItem.displayColor()).isNull();

    // A CONFLICT item still carries the PACK rule's own colour, not the existing rule's - the two can legitimately
    // differ (that is what state 91's tag-colour-conflict panel is drawn for) without the preview confusing them.
    byte[] conflictingColourPack = """
        {"format":"log-explorer-classification-pack","schemaVersion":1,
         "rules":[{"id":"a","name":"Rule a","tags":["different-tag"],"displayColor":"PURPLE",
                   "conditions":[{"field":"message","matcher":"CONTAINS","value":"changed"}]}]}"""
        .getBytes(StandardCharsets.UTF_8);
    ClassificationRuleService.ImportPreview conflictPreview = service.previewImport(conflictingColourPack);
    assertThat(conflictPreview.items()).singleElement().satisfies(item -> {
      assertThat(item.status()).isEqualTo(ClassificationRuleService.ImportItem.Status.CONFLICT);
      assertThat(item.displayColor()).isEqualTo(TagColor.PURPLE);
    });
    assertThat(service.state().document().rules().get(0).displayColor()).isEqualTo(TagColor.BLUE);
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
