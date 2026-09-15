package com.logexplorer.core.classify;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonMappingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.logexplorer.config.ClassificationProperties;
import java.io.IOException;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.locks.ReentrantLock;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * Owns the rules configuration lifecycle: load (with last-known-good
 * recovery), create/update/delete with optimistic revision checks, export,
 * and two-phase import. Every successful change goes through one path —
 * validate + compile, atomic write, then atomically swap the engine's
 * in-memory snapshot — so the engine never sees an unvalidated rule and
 * disk and memory never disagree after a successful write.
 */
@Service
public class ClassificationRuleService {

  private static final Logger log = LoggerFactory.getLogger(ClassificationRuleService.class);
  private static final Set<String> PACK_PROPERTIES = Set.of("format", "schemaVersion", "pack", "rules");
  static final String DEFAULT_PACK_NAME = "Log Explorer classification rules";

  private final ClassificationRuleRepository repository;
  private final RuleCompiler compiler;
  private final ClassificationEngine engine;
  private final Clock clock;
  private final ObjectMapper packMapper = ClassificationJson.strictMapper();
  private final RulesSchemaMigrator migrator = new RulesSchemaMigrator();
  private final ReentrantLock writeLock = new ReentrantLock();
  private volatile State state;

  /**
   * @param primaryInvalid true when the primary file exists but is unusable — the next write moves it aside
   *     as {@code .corrupt-<timestamp>} instead of overwriting it
   */
  public record State(RulesDocument document, ConfigurationStatus status, String statusMessage, boolean primaryInvalid,
      String storageFile) {
  }

  public record ImportItem(int index, String id, String name, List<String> tags, Status status, String existingName,
      List<RuleValidationError> errors) {
    public enum Status { NEW, IDENTICAL, CONFLICT, INVALID }
  }

  public record ImportPreview(ClassificationPack.PackInfo pack, int rulesInPack, int newRules, int identical,
      int conflicts, int invalid, List<ImportItem> items, long currentRevision) {
  }

  public record ImportResult(State state, int added, int replaced, int unchanged, int keptExisting, int removed) {
  }

  private record ParsedItem(int index, ClassificationRule rule, List<RuleValidationError> errors) {
  }

  private record ParsedPack(ClassificationPack.PackInfo info, List<ParsedItem> items) {
  }

  @Autowired
  public ClassificationRuleService(ClassificationProperties properties, RuleCompiler compiler, ClassificationEngine engine) {
    this(new ClassificationRuleRepository(Path.of(properties.getRulesFile())), compiler, engine, Clock.systemUTC());
  }

  public ClassificationRuleService(ClassificationRuleRepository repository, RuleCompiler compiler,
      ClassificationEngine engine, Clock clock) {
    this.repository = repository;
    this.compiler = compiler;
    this.engine = engine;
    this.clock = clock;
    reload();
  }

  // ------------------------------------------------------------------ load

  public State reload() {
    writeLock.lock();
    try {
      State loaded = load();
      activate(loaded.document());
      state = loaded;
      return loaded;
    } finally {
      writeLock.unlock();
    }
  }

  private State load() {
    String storage = repository.primaryFile().toString();
    if (!repository.primaryExists()) {
      if (repository.backupExists()) {
        try {
          RulesDocument backup = validated(repository.readBackup());
          return new State(backup, ConfigurationStatus.RECOVERED_FROM_BACKUP,
              "The rules file was missing; the last known good backup is active.", false, storage);
        } catch (RuntimeException e) {
          log.warn("Classification rules backup is not usable ({})", e.getClass().getSimpleName());
        }
      }
      return new State(RulesDocument.empty(), ConfigurationStatus.OK, null, false, storage);
    }
    try {
      return new State(validated(repository.readPrimary()), ConfigurationStatus.OK, null, false, storage);
    } catch (RuntimeException primaryError) {
      String reason = safeReason(primaryError);
      log.warn("Classification rules file is invalid ({}); search continues", reason);
      if (repository.backupExists()) {
        try {
          RulesDocument backup = validated(repository.readBackup());
          return new State(backup, ConfigurationStatus.RECOVERED_FROM_BACKUP,
              "The rules file is invalid (" + reason + "). The last known good backup is active. The invalid file "
                  + "is kept and will be moved aside as a .corrupt copy on the next save.", true, storage);
        } catch (RuntimeException backupError) {
          log.warn("Classification rules backup is not usable ({})", safeReason(backupError));
        }
      }
      return new State(RulesDocument.empty(), ConfigurationStatus.INVALID,
          "The rules file is invalid (" + reason + ") and no valid backup exists. Classification is off; search "
              + "keeps working. Fix the file, or save or import rules to replace it (the invalid file is kept as a "
              + ".corrupt copy).", true, storage);
    }
  }

  private static String safeReason(RuntimeException e) {
    if (e instanceof ClassificationRuleRepository.RulesFileException) {
      return e.getMessage();
    }
    if (e instanceof RuleValidationException) {
      return "a rule in the file failed validation";
    }
    return e.getClass().getSimpleName();
  }

  private RulesDocument validated(RulesDocument document) {
    compileAll(document.rules());
    return document;
  }

  private List<CompiledRule> compileAll(List<ClassificationRule> rules) {
    if (rules.size() > ClassificationLimits.MAX_RULES) {
      throw new RuleValidationException(List.of(new RuleValidationError("rules",
          "At most " + ClassificationLimits.MAX_RULES + " rules are allowed")));
    }
    Set<String> ids = new HashSet<>();
    List<CompiledRule> compiled = new ArrayList<>(rules.size());
    for (int i = 0; i < rules.size(); i++) {
      ClassificationRule rule = rules.get(i);
      if (rule == null || rule.id() == null || rule.id().isBlank()) {
        throw new RuleValidationException(List.of(new RuleValidationError("rules[" + i + "].id", "A rule id is required")));
      }
      if (!ids.add(rule.id())) {
        throw new RuleValidationException(List.of(new RuleValidationError("rules[" + i + "].id", "Duplicate rule id")));
      }
      compiled.add(compiler.compile(rule));
    }
    return compiled;
  }

  private void activate(RulesDocument document) {
    try {
      engine.activate(CompiledRuleSet.ofEnabled(document.revisionOrZero(), compileAll(document.rules())));
    } catch (RuntimeException e) {
      engine.activate(CompiledRuleSet.EMPTY);
    }
  }

  public State state() {
    return state;
  }

  // ------------------------------------------------------------------ CRUD

  public State create(Long expectedRevision, ClassificationRule input) {
    writeLock.lock();
    try {
      State current = state;
      checkRevision(expectedRevision, current);
      if (input == null) {
        throw ClassificationRulesException.badRequest("RULE_REQUIRED", "A rule is required");
      }
      List<ClassificationRule> rules = new ArrayList<>(current.document().rules());
      if (rules.size() >= ClassificationLimits.MAX_RULES) {
        throw ClassificationRulesException.badRequest("RULE_LIMIT_EXCEEDED",
            "At most " + ClassificationLimits.MAX_RULES + " rules are allowed");
      }
      ClassificationRule rule = input.normalized();
      Set<String> existingIds = rules.stream().map(ClassificationRule::id).collect(Collectors.toSet());
      String id = rule.id() == null ? generateId(rule.name(), existingIds) : rule.id();
      if (existingIds.contains(id)) {
        throw ClassificationRulesException.conflict("RULE_ID_EXISTS", "A rule with this id already exists", null);
      }
      Instant now = clock.instant();
      ClassificationRule toSave = compiler.compile(rule.withId(id).withMetadata(now, now)).rule();
      rules.add(toSave);
      return persist(current, rules);
    } finally {
      writeLock.unlock();
    }
  }

  public State update(String id, Long expectedRevision, ClassificationRule input) {
    writeLock.lock();
    try {
      State current = state;
      checkRevision(expectedRevision, current);
      if (input == null) {
        throw ClassificationRulesException.badRequest("RULE_REQUIRED", "A rule is required");
      }
      List<ClassificationRule> rules = new ArrayList<>(current.document().rules());
      int index = indexOf(rules, id);
      ClassificationRule rule = input.normalized();
      if (rule.id() != null && !rule.id().equals(id)) {
        throw ClassificationRulesException.badRequest("RULE_ID_MISMATCH", "The rule id cannot be changed");
      }
      ClassificationRule existing = rules.get(index);
      ClassificationRule toSave = compiler.compile(rule.withId(id).withMetadata(existing.createdAt(), clock.instant())).rule();
      rules.set(index, toSave);
      return persist(current, rules);
    } finally {
      writeLock.unlock();
    }
  }

  public State delete(String id, Long expectedRevision) {
    writeLock.lock();
    try {
      State current = state;
      checkRevision(expectedRevision, current);
      List<ClassificationRule> rules = new ArrayList<>(current.document().rules());
      rules.remove(indexOf(rules, id));
      return persist(current, rules);
    } finally {
      writeLock.unlock();
    }
  }

  private static int indexOf(List<ClassificationRule> rules, String id) {
    for (int i = 0; i < rules.size(); i++) {
      if (rules.get(i).id().equals(id)) {
        return i;
      }
    }
    throw ClassificationRulesException.notFound("RULE_NOT_FOUND", "No rule with this id exists");
  }

  private void checkRevision(Long expectedRevision, State current) {
    if (expectedRevision == null) {
      throw ClassificationRulesException.badRequest("REVISION_REQUIRED",
          "expectedRevision is required so concurrent edits are never silently overwritten");
    }
    long currentRevision = current.document().revisionOrZero();
    if (expectedRevision != currentRevision) {
      Map<String, Object> properties = new LinkedHashMap<>();
      properties.put("currentRevision", currentRevision);
      throw ClassificationRulesException.conflict("RULES_REVISION_CONFLICT",
          "The rules were changed elsewhere (for example in another window). Refresh to see the latest rules, then "
              + "apply your change again.", properties);
    }
  }

  static String generateId(String name, Set<String> existing) {
    String base = name == null ? "" : name.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-").replaceAll("^-+|-+$", "");
    if (base.length() > 56) {
      base = base.substring(0, 56).replaceAll("-+$", "");
    }
    if (base.isEmpty()) {
      base = "rule";
    }
    String candidate = base;
    int suffix = 2;
    while (existing.contains(candidate)) {
      candidate = base + "-" + suffix++;
    }
    return candidate;
  }

  private State persist(State current, List<ClassificationRule> rules) {
    long revision = current.document().revisionOrZero() + 1;
    List<ClassificationRule> ordered = rules.stream()
        .sorted((a, b) -> a.effectivePriority() != b.effectivePriority()
            ? Integer.compare(a.effectivePriority(), b.effectivePriority())
            : a.id().compareTo(b.id()))
        .toList();
    List<CompiledRule> compiled = compileAll(ordered);
    RulesDocument next = new RulesDocument(RulesDocument.FORMAT, RulesSchemaMigrator.CURRENT_SCHEMA_VERSION, revision,
        clock.instant(), ordered);
    try {
      repository.write(next, current.primaryInvalid());
    } catch (IOException | RuntimeException e) {
      log.warn("Classification rules could not be written ({})", e.getClass().getSimpleName());
      throw ClassificationRulesException.unavailable("RULES_STORAGE_UNAVAILABLE",
          "The rules could not be saved to the server's data directory. Check that it exists and is writable. "
              + "Nothing was changed.");
    }
    engine.activate(CompiledRuleSet.ofEnabled(revision, compiled));
    State saved = new State(next, ConfigurationStatus.OK, null, false, current.storageFile());
    state = saved;
    log.info("Classification rules saved (revision {}, {} rules)", revision, ordered.size());
    return saved;
  }

  // ------------------------------------------------------------------ export

  public ClassificationPack exportPack(List<String> ids, String name) {
    List<ClassificationRule> rules = state.document().rules();
    List<ClassificationRule> selected;
    if (ids == null || ids.isEmpty()) {
      selected = rules;
    } else {
      Set<String> wanted = new HashSet<>(ids);
      selected = rules.stream().filter(r -> wanted.contains(r.id())).toList();
      if (selected.size() != wanted.size()) {
        throw ClassificationRulesException.notFound("RULE_NOT_FOUND", "One or more selected rules no longer exist");
      }
    }
    String packName = name == null || name.isBlank() ? DEFAULT_PACK_NAME : name.trim();
    if (packName.length() > ClassificationLimits.MAX_NAME_LENGTH) {
      packName = packName.substring(0, ClassificationLimits.MAX_NAME_LENGTH);
    }
    return new ClassificationPack(ClassificationPack.FORMAT, RulesSchemaMigrator.CURRENT_SCHEMA_VERSION,
        new ClassificationPack.PackInfo(packName, null, "1", clock.instant()),
        selected.stream().map(ClassificationRule::withoutMetadata).toList());
  }

  public byte[] exportPackBytes(List<String> ids, String name) {
    try {
      return packMapper.writeValueAsBytes(exportPack(ids, name));
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("Pack serialization failed", e);
    }
  }

  // ------------------------------------------------------------------ import

  public ImportPreview previewImport(byte[] body) {
    State current = state;
    ParsedPack parsed = parsePack(body);
    Map<String, ClassificationRule> existing = byId(current.document().rules());
    List<ImportItem> items = new ArrayList<>();
    int newRules = 0;
    int identical = 0;
    int conflicts = 0;
    int invalid = 0;
    for (ParsedItem item : parsed.items()) {
      ClassificationRule rule = item.rule();
      String id = rule == null ? null : rule.id();
      String name = rule == null ? null : rule.name();
      List<String> tags = rule == null ? List.of() : rule.tags();
      if (!item.errors().isEmpty()) {
        invalid++;
        items.add(new ImportItem(item.index(), id, name, tags, ImportItem.Status.INVALID, null, item.errors()));
        continue;
      }
      ClassificationRule match = existing.get(id);
      if (match == null) {
        newRules++;
        items.add(new ImportItem(item.index(), id, name, tags, ImportItem.Status.NEW, null, List.of()));
      } else if (match.sameContentAs(rule)) {
        identical++;
        items.add(new ImportItem(item.index(), id, name, tags, ImportItem.Status.IDENTICAL, match.name(), List.of()));
      } else {
        conflicts++;
        items.add(new ImportItem(item.index(), id, name, tags, ImportItem.Status.CONFLICT, match.name(), List.of()));
      }
    }
    return new ImportPreview(parsed.info(), parsed.items().size(), newRules, identical, conflicts, invalid, items,
        current.document().revisionOrZero());
  }

  public ImportResult applyImport(byte[] body, ImportMode mode, ConflictResolution resolution, Long expectedRevision,
      boolean confirmReplaceAll) {
    writeLock.lock();
    try {
      State current = state;
      checkRevision(expectedRevision, current);
      if (mode == null) {
        throw ClassificationRulesException.badRequest("IMPORT_MODE_REQUIRED", "Choose MERGE or REPLACE_ALL");
      }
      ParsedPack parsed = parsePack(body);
      if (parsed.items().stream().anyMatch(i -> !i.errors().isEmpty())) {
        throw ClassificationRulesException.badRequest("IMPORT_HAS_INVALID_RULES",
            "The pack contains invalid rules. Nothing was imported; fix the pack and preview it again.");
      }
      Map<String, ClassificationRule> existing = byId(current.document().rules());
      Instant now = clock.instant();
      int added = 0;
      int replaced = 0;
      int unchanged = 0;
      int keptExisting = 0;
      int removed = 0;
      List<ClassificationRule> result;
      if (mode == ImportMode.REPLACE_ALL) {
        if (!confirmReplaceAll) {
          throw ClassificationRulesException.badRequest("IMPORT_REPLACE_NOT_CONFIRMED",
              "Replacing all rules deletes every existing rule. Confirm the replacement explicitly.");
        }
        result = new ArrayList<>();
        Set<String> importedIds = new HashSet<>();
        for (ParsedItem item : parsed.items()) {
          ClassificationRule rule = item.rule();
          importedIds.add(rule.id());
          ClassificationRule before = existing.get(rule.id());
          if (before == null) {
            added++;
            result.add(rule.withMetadata(now, now));
          } else if (before.sameContentAs(rule)) {
            unchanged++;
            result.add(before);
          } else {
            replaced++;
            result.add(rule.withMetadata(before.createdAt(), now));
          }
        }
        removed = (int) existing.keySet().stream().filter(id -> !importedIds.contains(id)).count();
      } else {
        boolean hasConflicts = parsed.items().stream().anyMatch(i -> {
          ClassificationRule before = existing.get(i.rule().id());
          return before != null && !before.sameContentAs(i.rule());
        });
        if (hasConflicts && resolution == null) {
          throw ClassificationRulesException.badRequest("IMPORT_CONFLICT_RESOLUTION_REQUIRED",
              "Some imported rules conflict with existing rules. Choose KEEP_EXISTING or USE_IMPORTED.");
        }
        Map<String, ClassificationRule> merged = new LinkedHashMap<>(existing);
        for (ParsedItem item : parsed.items()) {
          ClassificationRule rule = item.rule();
          ClassificationRule before = existing.get(rule.id());
          if (before == null) {
            added++;
            merged.put(rule.id(), rule.withMetadata(now, now));
          } else if (before.sameContentAs(rule)) {
            unchanged++;
          } else if (resolution == ConflictResolution.USE_IMPORTED) {
            replaced++;
            merged.put(rule.id(), rule.withMetadata(before.createdAt(), now));
          } else {
            keptExisting++;
          }
        }
        result = new ArrayList<>(merged.values());
      }
      if (result.size() > ClassificationLimits.MAX_RULES) {
        throw ClassificationRulesException.badRequest("RULE_LIMIT_EXCEEDED",
            "The import would exceed " + ClassificationLimits.MAX_RULES + " rules. Nothing was imported.");
      }
      if (added == 0 && replaced == 0 && removed == 0) {
        return new ImportResult(current, 0, 0, unchanged, keptExisting, 0);
      }
      State saved = persist(current, result);
      return new ImportResult(saved, added, replaced, unchanged, keptExisting, removed);
    } finally {
      writeLock.unlock();
    }
  }

  private static Map<String, ClassificationRule> byId(List<ClassificationRule> rules) {
    Map<String, ClassificationRule> map = new LinkedHashMap<>();
    for (ClassificationRule rule : rules) {
      map.put(rule.id(), rule);
    }
    return map;
  }

  private ParsedPack parsePack(byte[] body) {
    if (body == null || body.length == 0) {
      throw ClassificationRulesException.badRequest("IMPORT_EMPTY", "The file is empty");
    }
    if (body.length > ClassificationLimits.MAX_IMPORT_BYTES) {
      throw ClassificationRulesException.tooLarge("IMPORT_TOO_LARGE",
          "The file is larger than the " + ClassificationLimits.MAX_IMPORT_BYTES + "-byte import limit");
    }
    JsonNode root;
    try {
      root = packMapper.readTree(body);
    } catch (IOException e) {
      throw ClassificationRulesException.badRequest("IMPORT_INVALID_JSON", "The file is not valid JSON");
    }
    if (root == null || !root.isObject()) {
      throw ClassificationRulesException.badRequest("IMPORT_WRONG_FORMAT", "The file is not a classification rule pack");
    }
    String format = root.path("format").asText(null);
    if (RulesDocument.FORMAT.equals(format)) {
      throw ClassificationRulesException.badRequest("IMPORT_WRONG_FORMAT",
          "This is Log Explorer's internal rules file, not a portable pack. Use Export to create a pack.");
    }
    if (!ClassificationPack.FORMAT.equals(format)) {
      throw ClassificationRulesException.badRequest("IMPORT_WRONG_FORMAT",
          "The file is not a Log Explorer classification rule pack (expected format \"" + ClassificationPack.FORMAT + "\")");
    }
    ObjectNode migrated;
    try {
      migrated = migrator.migrateToCurrent((ObjectNode) root);
    } catch (RulesSchemaMigrator.UnsupportedSchemaVersionException e) {
      throw ClassificationRulesException.badRequest("IMPORT_UNSUPPORTED_SCHEMA_VERSION", e.getMessage());
    }
    for (Iterator<String> names = migrated.fieldNames(); names.hasNext(); ) {
      String property = names.next();
      if (!PACK_PROPERTIES.contains(property)) {
        throw ClassificationRulesException.badRequest("IMPORT_INVALID_STRUCTURE",
            "The pack has an unsupported top-level property");
      }
    }
    JsonNode rulesNode = migrated.get("rules");
    if (rulesNode == null || !rulesNode.isArray()) {
      throw ClassificationRulesException.badRequest("IMPORT_INVALID_STRUCTURE", "The pack has no rules list");
    }
    if (rulesNode.size() > ClassificationLimits.MAX_IMPORT_RULES) {
      throw ClassificationRulesException.badRequest("IMPORT_TOO_MANY_RULES",
          "The pack has more than " + ClassificationLimits.MAX_IMPORT_RULES + " rules");
    }
    ClassificationPack.PackInfo info = null;
    JsonNode packNode = migrated.get("pack");
    if (packNode != null && !packNode.isNull()) {
      try {
        info = packMapper.treeToValue(packNode, ClassificationPack.PackInfo.class);
      } catch (IOException | IllegalArgumentException e) {
        throw ClassificationRulesException.badRequest("IMPORT_INVALID_STRUCTURE", "The pack description section is not valid");
      }
    }
    List<ParsedItem> items = new ArrayList<>();
    Map<String, Integer> seenIds = new HashMap<>();
    for (int i = 0; i < rulesNode.size(); i++) {
      String path = "rules[" + i + "]";
      ClassificationRule rule;
      try {
        rule = packMapper.treeToValue(rulesNode.get(i), ClassificationRule.class);
      } catch (IOException | IllegalArgumentException e) {
        items.add(new ParsedItem(i, null, List.of(new RuleValidationError(path + jsonPath(e), "Unexpected or invalid property"))));
        continue;
      }
      if (rule == null) {
        items.add(new ParsedItem(i, null, List.of(new RuleValidationError(path, "Empty rule entry"))));
        continue;
      }
      ClassificationRule normalized = rule.normalized().withoutMetadata();
      List<RuleValidationError> errors = new ArrayList<>();
      if (normalized.id() == null) {
        errors.add(new RuleValidationError(path + ".id", "Rules in a pack need an id"));
      } else if (seenIds.putIfAbsent(normalized.id(), i) != null) {
        errors.add(new RuleValidationError(path + ".id", "Duplicate rule id in this pack"));
      }
      try {
        compiler.compile(normalized);
      } catch (RuleValidationException e) {
        for (RuleValidationError error : e.errors()) {
          errors.add(new RuleValidationError(path + (error.path().isEmpty() ? "" : "." + error.path()), error.message()));
        }
      }
      items.add(new ParsedItem(i, normalized, errors));
    }
    return new ParsedPack(info, items);
  }

  private static String jsonPath(Exception e) {
    if (!(e instanceof JsonMappingException mapping)) {
      return "";
    }
    StringBuilder path = new StringBuilder();
    for (JsonMappingException.Reference reference : mapping.getPath()) {
      if (reference.getFieldName() != null) {
        path.append('.').append(reference.getFieldName());
      } else if (reference.getIndex() >= 0) {
        path.append('[').append(reference.getIndex()).append(']');
      }
    }
    return path.toString();
  }
}
