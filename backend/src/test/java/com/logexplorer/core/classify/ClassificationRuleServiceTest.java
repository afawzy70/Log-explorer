package com.logexplorer.core.classify;

import static com.logexplorer.core.classify.ClassificationTestRules.condition;
import static com.logexplorer.core.classify.ClassificationTestRules.middlewareRule;
import static com.logexplorer.core.classify.ClassificationTestRules.rule;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ClassificationRuleServiceTest {

  @TempDir
  Path dir;

  private Path file;
  private ClassificationEngine engine;
  private final Clock clock = Clock.fixed(Instant.parse("2026-09-15T10:00:00Z"), ZoneOffset.UTC);
  private final ObjectMapper mapper = new ObjectMapper();

  @BeforeEach
  void setUp() {
    file = dir.resolve("data").resolve("classification-rules.json");
    engine = new ClassificationEngine(new ObjectMapper());
  }

  private ClassificationRuleService service() {
    return new ClassificationRuleService(new ClassificationRuleRepository(file), new RuleCompiler(), engine, clock);
  }

  private static int status(Throwable e) {
    return ((ClassificationRulesException) e).status();
  }

  private static String reason(Throwable e) {
    return ((ClassificationRulesException) e).reason();
  }

  private List<Path> filesInDataDir() throws IOException {
    if (!Files.exists(file.getParent())) {
      return List.of();
    }
    try (Stream<Path> files = Files.list(file.getParent())) {
      return files.toList();
    }
  }

  // ------------------------------------------------------------------ persistence

  @Test
  void missingFileStartsEmptyAndWritesNothing() {
    ClassificationRuleService service = service();
    assertThat(service.state().status()).isEqualTo(ConfigurationStatus.OK);
    assertThat(service.state().document().revisionOrZero()).isZero();
    assertThat(Files.exists(file)).isFalse();
    assertThat(Files.exists(file.getParent())).isFalse();
  }

  @Test
  void firstSaveCreatesTheFileActivatesTheRuleAndReloadsInAFreshInstance() throws IOException {
    ClassificationRuleService service = service();
    ClassificationRuleService.State saved = service.create(0L, middlewareRule());
    assertThat(saved.document().revision()).isEqualTo(1);
    assertThat(Files.exists(file)).isTrue();
    assertThat(engine.activeRuleSet().rules()).hasSize(1);

    JsonNode onDisk = mapper.readTree(file.toFile());
    assertThat(onDisk.get("format").asText()).isEqualTo(RulesDocument.FORMAT);
    assertThat(onDisk.get("schemaVersion").asInt()).isEqualTo(1);
    assertThat(onDisk.get("revision").asLong()).isEqualTo(1);

    ClassificationEngine freshEngine = new ClassificationEngine(new ObjectMapper());
    ClassificationRuleService reloaded =
        new ClassificationRuleService(new ClassificationRuleRepository(file), new RuleCompiler(), freshEngine, clock);
    assertThat(reloaded.state().document().rules()).extracting(ClassificationRule::id).containsExactly("middleware-http-call");
    assertThat(freshEngine.activeRuleSet().rules()).hasSize(1);
  }

  @Test
  void idIsGeneratedFromTheNameWhenOmitted() {
    ClassificationRule noId = middlewareRule().withId(null);
    ClassificationRuleService service = service();
    service.create(0L, noId);
    service.create(1L, noId);
    assertThat(service.state().document().rules()).extracting(ClassificationRule::id)
        .containsExactly("middleware-http-call", "middleware-http-call-2");
  }

  @Test
  void editKeepsCreatedAtEnableDisableAndDeleteEachBumpTheRevision() {
    ClassificationRuleService service = service();
    service.create(0L, middlewareRule());
    ClassificationRule disabled = new ClassificationRule(null, "Middleware HTTP Call", "edited", List.of("middleware"),
        false, 100, MatchMode.ALL, middlewareRule().conditions(), middlewareRule().extractions(), null, null);
    ClassificationRuleService.State edited = service.update("middleware-http-call", 1L, disabled);
    assertThat(edited.document().revision()).isEqualTo(2);
    assertThat(edited.document().rules().get(0).enabled()).isFalse();
    assertThat(edited.document().rules().get(0).createdAt()).isEqualTo(clock.instant());
    assertThat(engine.activeRuleSet().rules()).isEmpty();

    ClassificationRuleService.State deleted = service.delete("middleware-http-call", 2L);
    assertThat(deleted.document().revision()).isEqualTo(3);
    assertThat(deleted.document().rules()).isEmpty();
  }

  @Test
  void staleOrMissingRevisionIsRejectedAndNothingIsWritten() throws IOException {
    ClassificationRuleService service = service();
    service.create(0L, middlewareRule());
    String before = Files.readString(file);
    assertThatThrownBy(() -> service.create(0L, rule("other", "t", condition("message", MatcherType.CONTAINS, "x"))))
        .satisfies(e -> {
          assertThat(status(e)).isEqualTo(409);
          assertThat(reason(e)).isEqualTo("RULES_REVISION_CONFLICT");
          assertThat(((ClassificationRulesException) e).properties()).containsEntry("currentRevision", 1L);
        });
    assertThatThrownBy(() -> service.delete("middleware-http-call", null))
        .satisfies(e -> assertThat(reason(e)).isEqualTo("REVISION_REQUIRED"));
    assertThat(Files.readString(file)).isEqualTo(before);
  }

  @Test
  void invalidRuleIsRejectedBeforeAnyWrite() {
    ClassificationRuleService service = service();
    assertThatThrownBy(() -> service.create(0L, rule("bad", "t", condition("message", MatcherType.REGEX, "(?<=x)y"))))
        .isInstanceOf(RuleValidationException.class);
    assertThat(Files.exists(file)).isFalse();
  }

  @Test
  void concurrentWritersBasedOnTheSameRevisionCannotBothWin() throws Exception {
    ClassificationRuleService service = service();
    ExecutorService pool = Executors.newFixedThreadPool(2);
    CountDownLatch start = new CountDownLatch(1);
    try {
      Future<Boolean> a = pool.submit(() -> attempt(service, start, "rule-a"));
      Future<Boolean> b = pool.submit(() -> attempt(service, start, "rule-b"));
      start.countDown();
      assertThat(List.of(a.get(), b.get())).containsExactlyInAnyOrder(true, false);
    } finally {
      pool.shutdownNow();
    }
    assertThat(service.state().document().rules()).hasSize(1);
  }

  private static boolean attempt(ClassificationRuleService service, CountDownLatch start, String id) throws Exception {
    start.await();
    try {
      service.create(0L, rule(id, "t", condition("message", MatcherType.CONTAINS, id)));
      return true;
    } catch (ClassificationRulesException e) {
      return false;
    }
  }

  @Test
  void writesLeaveNoTemporaryFilesAndKeepTheLastKnownGoodBackup() throws IOException {
    ClassificationRuleService service = service();
    service.create(0L, middlewareRule());
    service.create(1L, rule("second", "t", condition("message", MatcherType.CONTAINS, "x")));
    assertThat(filesInDataDir()).extracting(p -> p.getFileName().toString())
        .containsExactlyInAnyOrder("classification-rules.json", "classification-rules.json.bak");
    assertThat(mapper.readTree(file.resolveSibling("classification-rules.json.bak").toFile()).get("revision").asLong())
        .isEqualTo(1);
  }

  @Test
  void corruptPrimaryRecoversFromBackupAndIsMovedAsideRatherThanOverwritten() throws IOException {
    ClassificationRuleService first = service();
    first.create(0L, middlewareRule());
    first.create(1L, rule("second", "t", condition("message", MatcherType.CONTAINS, "x")));
    Files.writeString(file, "{ this is not json");

    ClassificationRuleService recovered = service();
    assertThat(recovered.state().status()).isEqualTo(ConfigurationStatus.RECOVERED_FROM_BACKUP);
    assertThat(recovered.state().statusMessage()).doesNotContain("this is not json");
    assertThat(recovered.state().document().revision()).isEqualTo(1);
    assertThat(Files.readString(file)).isEqualTo("{ this is not json");

    recovered.create(1L, rule("third", "t", condition("message", MatcherType.CONTAINS, "y")));
    assertThat(filesInDataDir()).anySatisfy(p -> {
      assertThat(p.getFileName().toString()).startsWith("classification-rules.json.corrupt-");
      assertThat(Files.readString(p)).isEqualTo("{ this is not json");
    });
    assertThat(recovered.state().status()).isEqualTo(ConfigurationStatus.OK);
  }

  @Test
  void corruptPrimaryAndCorruptBackupFailSafelyWithClassificationOff() throws IOException {
    Files.createDirectories(file.getParent());
    Files.writeString(file, "{\"format\":\"log-explorer-classification-rules\",\"schemaVersion\":1,\"revision\":4,"
        + "\"rules\":[{\"id\":\"x\",\"name\":\"X\",\"tags\":[\"t\"],\"conditions\":[{\"field\":\"message\","
        + "\"matcher\":\"REGEX\",\"value\":\"(unclosed\"}]}]}");
    Files.writeString(file.resolveSibling("classification-rules.json.bak"), "garbage");

    ClassificationRuleService service = service();
    assertThat(service.state().status()).isEqualTo(ConfigurationStatus.INVALID);
    assertThat(service.state().document().rules()).isEmpty();
    assertThat(engine.activeRuleSet().rules()).isEmpty();
    assertThat(Files.readString(file)).contains("(unclosed");
  }

  @Test
  void newerSchemaVersionIsNotReadAsCurrent() throws IOException {
    Files.createDirectories(file.getParent());
    Files.writeString(file, "{\"format\":\"log-explorer-classification-rules\",\"schemaVersion\":99,\"revision\":1,"
        + "\"rules\":[]}");
    ClassificationRuleService service = service();
    assertThat(service.state().status()).isEqualTo(ConfigurationStatus.INVALID);
    assertThat(service.state().statusMessage()).contains("newer than this Log Explorer supports");
  }

  @Test
  void unwritableStorageReturns503AndLeavesStateUnchanged() throws IOException {
    Path blocker = dir.resolve("not-a-directory");
    Files.writeString(blocker, "file");
    file = blocker.resolve("classification-rules.json");
    ClassificationRuleService service = service();
    assertThatThrownBy(() -> service.create(0L, middlewareRule()))
        .satisfies(e -> {
          assertThat(status(e)).isEqualTo(503);
          assertThat(reason(e)).isEqualTo("RULES_STORAGE_UNAVAILABLE");
        });
    assertThat(service.state().document().revisionOrZero()).isZero();
    assertThat(engine.activeRuleSet().rules()).isEmpty();
  }

  // ------------------------------------------------------------------ export / import

  private byte[] export(ClassificationRuleService service, List<String> ids) {
    return service.exportPackBytes(ids, "Synthetic pack");
  }

  @Test
  void exportImportRoundTripIntoAnotherInstallation() throws IOException {
    ClassificationRuleService source = service();
    source.create(0L, middlewareRule());
    source.create(1L, rule("frontend-call", "frontend-call", condition("message", MatcherType.CONTAINS, "ui call")));
    byte[] pack = export(source, null);

    Path otherFile = dir.resolve("other").resolve("classification-rules.json");
    ClassificationRuleService target = new ClassificationRuleService(new ClassificationRuleRepository(otherFile),
        new RuleCompiler(), new ClassificationEngine(new ObjectMapper()), clock);
    ClassificationRuleService.ImportPreview preview = target.previewImport(pack);
    assertThat(preview.rulesInPack()).isEqualTo(2);
    assertThat(preview.newRules()).isEqualTo(2);
    assertThat(Files.exists(otherFile)).as("preview writes nothing").isFalse();

    ClassificationRuleService.ImportResult result = target.applyImport(pack, ImportMode.MERGE, null, 0L, false);
    assertThat(result.added()).isEqualTo(2);
    assertThat(target.state().document().rules()).extracting(ClassificationRule::withoutMetadata)
        .containsExactlyInAnyOrderElementsOf(source.state().document().rules().stream()
            .map(ClassificationRule::withoutMetadata).toList());
  }

  @Test
  void exportedPackContainsRuleDefinitionsOnlyAndPassesImportValidation() throws IOException {
    ClassificationRuleService service = service();
    service.create(0L, middlewareRule());
    byte[] pack = export(service, List.of("middleware-http-call"));
    JsonNode root = mapper.readTree(pack);
    assertThat(root.get("format").asText()).isEqualTo(ClassificationPack.FORMAT);
    assertThat(root.has("revision")).isFalse();
    String text = new String(pack, StandardCharsets.UTF_8);
    assertThat(text).doesNotContain("createdAt", "updatedAt", dir.toString(), "classification-rules.json");
    assertThat(service.previewImport(pack).identical()).isEqualTo(1);
  }

  @Test
  void exportOfAnUnknownSelectedRuleIsRejected() {
    ClassificationRuleService service = service();
    assertThatThrownBy(() -> export(service, List.of("missing"))).satisfies(e -> assertThat(status(e)).isEqualTo(404));
  }

  @Test
  void malformedWrongFormatUnsupportedVersionOversizedAndTooManyRulesAreRejected() {
    ClassificationRuleService service = service();
    assertThat(reasonOf(service, "{ nope")).isEqualTo("IMPORT_INVALID_JSON");
    assertThat(reasonOf(service, "[]")).isEqualTo("IMPORT_WRONG_FORMAT");
    assertThat(reasonOf(service, "{\"format\":\"something-else\",\"schemaVersion\":1,\"rules\":[]}"))
        .isEqualTo("IMPORT_WRONG_FORMAT");
    assertThat(reasonOf(service, "{\"format\":\"log-explorer-classification-rules\",\"schemaVersion\":1,\"rules\":[]}"))
        .isEqualTo("IMPORT_WRONG_FORMAT");
    assertThat(reasonOf(service, "{\"format\":\"log-explorer-classification-pack\",\"schemaVersion\":2,\"rules\":[]}"))
        .isEqualTo("IMPORT_UNSUPPORTED_SCHEMA_VERSION");
    assertThat(reasonOf(service, "{\"format\":\"log-explorer-classification-pack\",\"schemaVersion\":1,\"rules\":[],"
        + "\"credentials\":\"x\"}")).isEqualTo("IMPORT_INVALID_STRUCTURE");

    byte[] oversized = new byte[ClassificationLimits.MAX_IMPORT_BYTES + 1];
    assertThatThrownBy(() -> service.previewImport(oversized)).satisfies(e -> {
      assertThat(status(e)).isEqualTo(413);
      assertThat(reason(e)).isEqualTo("IMPORT_TOO_LARGE");
    });

    ObjectNode many = mapper.createObjectNode().put("format", ClassificationPack.FORMAT).put("schemaVersion", 1);
    ArrayNode rules = many.putArray("rules");
    for (int i = 0; i <= ClassificationLimits.MAX_IMPORT_RULES; i++) {
      rules.addObject().put("id", "r" + i);
    }
    assertThat(reasonOf(service, many.toString())).isEqualTo("IMPORT_TOO_MANY_RULES");
  }

  private static String reasonOf(ClassificationRuleService service, String body) {
    try {
      service.previewImport(body.getBytes(StandardCharsets.UTF_8));
      return "accepted";
    } catch (ClassificationRulesException e) {
      return e.reason();
    }
  }

  @Test
  void previewClassifiesNewIdenticalConflictAndInvalidIncludingUnsafeRegexAndDuplicates() {
    ClassificationRuleService service = service();
    service.create(0L, middlewareRule());
    service.create(1L, rule("changed", "t", condition("message", MatcherType.CONTAINS, "before")));
    String pack = """
        {"format":"log-explorer-classification-pack","schemaVersion":1,"pack":{"name":"Synthetic"},"rules":[
          %s,
          {"id":"changed","name":"Rule changed","tags":["t"],"conditions":[{"field":"message","matcher":"CONTAINS","value":"after"}]},
          {"id":"brand-new","name":"New","tags":["n"],"conditions":[{"field":"message","matcher":"EXACT","value":"x"}]},
          {"id":"unsafe","name":"Unsafe","tags":["u"],"conditions":[{"field":"message","matcher":"REGEX","value":"(\\\\w)\\\\1"}]},
          {"id":"brand-new","name":"Duplicate","tags":["n"],"conditions":[{"field":"message","matcher":"EXACT","value":"y"}]},
          {"id":"extra-prop","name":"X","tags":["x"],"secret":"nope","conditions":[{"field":"message","matcher":"EXACT","value":"z"}]}
        ]}""".formatted(new String(service.exportPackBytes(List.of("middleware-http-call"), null), StandardCharsets.UTF_8)
        .replaceAll("(?s)^.*\"rules\" : \\[\\s*", "").replaceAll("(?s)\\s*]\\s*}\\s*$", ""));
    ClassificationRuleService.ImportPreview preview = service.previewImport(pack.getBytes(StandardCharsets.UTF_8));
    assertThat(preview.pack().name()).isEqualTo("Synthetic");
    assertThat(preview.rulesInPack()).isEqualTo(6);
    assertThat(preview.identical()).isEqualTo(1);
    assertThat(preview.conflicts()).isEqualTo(1);
    assertThat(preview.newRules()).isEqualTo(1);
    assertThat(preview.invalid()).isEqualTo(3);
    assertThat(preview.items()).extracting(ClassificationRuleService.ImportItem::status).containsExactly(
        ClassificationRuleService.ImportItem.Status.IDENTICAL, ClassificationRuleService.ImportItem.Status.CONFLICT,
        ClassificationRuleService.ImportItem.Status.NEW, ClassificationRuleService.ImportItem.Status.INVALID,
        ClassificationRuleService.ImportItem.Status.INVALID, ClassificationRuleService.ImportItem.Status.INVALID);
    assertThatThrownBy(() -> service.applyImport(pack.getBytes(StandardCharsets.UTF_8), ImportMode.MERGE,
        ConflictResolution.USE_IMPORTED, 2L, false))
        .satisfies(e -> assertThat(reason(e)).isEqualTo("IMPORT_HAS_INVALID_RULES"));
    assertThat(service.state().document().revision()).isEqualTo(2);
  }

  private static byte[] pack(String rulesJson) {
    return ("{\"format\":\"log-explorer-classification-pack\",\"schemaVersion\":1,\"rules\":[" + rulesJson + "]}")
        .getBytes(StandardCharsets.UTF_8);
  }

  private static final String CHANGED_AFTER = "{\"id\":\"changed\",\"name\":\"Rule changed\",\"tags\":[\"t\"],"
      + "\"conditions\":[{\"field\":\"message\",\"matcher\":\"CONTAINS\",\"value\":\"after\"}]}";
  private static final String NEW_RULE = "{\"id\":\"brand-new\",\"name\":\"New\",\"tags\":[\"n\"],"
      + "\"conditions\":[{\"field\":\"message\",\"matcher\":\"EXACT\",\"value\":\"x\"}]}";

  @Test
  void mergeNeverSilentlyOverwritesConflictsAndHonoursTheExplicitResolution() {
    ClassificationRuleService service = service();
    service.create(0L, rule("changed", "t", condition("message", MatcherType.CONTAINS, "before")));
    byte[] body = pack(CHANGED_AFTER + "," + NEW_RULE);

    assertThatThrownBy(() -> service.applyImport(body, ImportMode.MERGE, null, 1L, false))
        .satisfies(e -> assertThat(reason(e)).isEqualTo("IMPORT_CONFLICT_RESOLUTION_REQUIRED"));

    ClassificationRuleService.ImportResult kept =
        service.applyImport(body, ImportMode.MERGE, ConflictResolution.KEEP_EXISTING, 1L, false);
    assertThat(kept.added()).isEqualTo(1);
    assertThat(kept.keptExisting()).isEqualTo(1);
    assertThat(service.state().document().rules()).filteredOn(r -> r.id().equals("changed"))
        .singleElement().satisfies(r -> assertThat(r.conditions().get(0).value()).isEqualTo("before"));

    ClassificationRuleService.ImportResult replaced =
        service.applyImport(body, ImportMode.MERGE, ConflictResolution.USE_IMPORTED, 2L, false);
    assertThat(replaced.replaced()).isEqualTo(1);
    assertThat(replaced.unchanged()).isEqualTo(1);
    assertThat(service.state().document().rules()).filteredOn(r -> r.id().equals("changed"))
        .singleElement().satisfies(r -> assertThat(r.conditions().get(0).value()).isEqualTo("after"));
  }

  @Test
  void replaceAllRequiresExplicitConfirmationThenReplacesEverything() {
    ClassificationRuleService service = service();
    service.create(0L, middlewareRule());
    byte[] body = pack(NEW_RULE);
    assertThatThrownBy(() -> service.applyImport(body, ImportMode.REPLACE_ALL, null, 1L, false))
        .satisfies(e -> assertThat(reason(e)).isEqualTo("IMPORT_REPLACE_NOT_CONFIRMED"));
    assertThat(service.state().document().rules()).hasSize(1);

    ClassificationRuleService.ImportResult result = service.applyImport(body, ImportMode.REPLACE_ALL, null, 1L, true);
    assertThat(result.added()).isEqualTo(1);
    assertThat(result.removed()).isEqualTo(1);
    assertThat(service.state().document().rules()).extracting(ClassificationRule::id).containsExactly("brand-new");
  }

  @Test
  void applyWithAStaleRevisionIsAConflictAndCancellingAPreviewWritesNothing() throws IOException {
    ClassificationRuleService service = service();
    service.create(0L, middlewareRule());
    String before = Files.readString(file);
    service.previewImport(pack(NEW_RULE));
    assertThat(Files.readString(file)).isEqualTo(before);
    assertThatThrownBy(() -> service.applyImport(pack(NEW_RULE), ImportMode.MERGE, null, 0L, false))
        .satisfies(e -> assertThat(status(e)).isEqualTo(409));
    assertThat(Files.readString(file)).isEqualTo(before);
  }

  @Test
  void importingOnlyIdenticalRulesDoesNotBumpTheRevision() {
    ClassificationRuleService service = service();
    service.create(0L, middlewareRule());
    byte[] pack = export(service, null);
    ClassificationRuleService.ImportResult result = service.applyImport(pack, ImportMode.MERGE, null, 1L, false);
    assertThat(result.unchanged()).isEqualTo(1);
    assertThat(service.state().document().revision()).isEqualTo(1);
  }
}
