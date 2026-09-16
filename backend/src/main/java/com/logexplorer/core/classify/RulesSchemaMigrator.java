package com.logexplorer.core.classify;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Schema evolution for both the internal rules file and portable packs.
 * Version 1 is current and has no historical migrations yet; a future
 * version registers a {@link Migration} from its predecessor. A document
 * newer than this build supports is rejected with a clear message — never
 * partially read with unknown structures silently ignored.
 */
public final class RulesSchemaMigrator {

  public static final int CURRENT_SCHEMA_VERSION = 1;

  /** Upgrades a document from {@link #fromVersion()} to {@code fromVersion() + 1}. */
  public interface Migration {
    int fromVersion();

    ObjectNode migrate(ObjectNode document);
  }

  public static class UnsupportedSchemaVersionException extends RuntimeException {
    public UnsupportedSchemaVersionException(String message) {
      super(message);
    }
  }

  private final Map<Integer, Migration> migrations = new HashMap<>();

  public RulesSchemaMigrator() {
    this(List.of());
  }

  public RulesSchemaMigrator(List<Migration> migrations) {
    for (Migration migration : migrations) {
      this.migrations.put(migration.fromVersion(), migration);
    }
  }

  public ObjectNode migrateToCurrent(ObjectNode document) {
    JsonNode versionNode = document.get("schemaVersion");
    if (versionNode == null || !versionNode.isIntegralNumber() || !versionNode.canConvertToInt()) {
      throw new UnsupportedSchemaVersionException("The file has no valid schemaVersion");
    }
    int version = versionNode.intValue();
    if (version > CURRENT_SCHEMA_VERSION) {
      throw new UnsupportedSchemaVersionException("Schema version " + version
          + " is newer than this Log Explorer supports (" + CURRENT_SCHEMA_VERSION + "). Upgrade Log Explorer to use it.");
    }
    ObjectNode current = document;
    while (version < CURRENT_SCHEMA_VERSION) {
      Migration migration = migrations.get(version);
      if (migration == null) {
        throw new UnsupportedSchemaVersionException("Schema version " + version + " is not supported");
      }
      current = migration.migrate(current.deepCopy());
      version++;
      current.put("schemaVersion", version);
    }
    return current;
  }
}
