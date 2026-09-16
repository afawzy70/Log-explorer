package com.logexplorer.core.classify;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.time.Clock;
import java.util.Arrays;
import java.util.Objects;
import java.util.UUID;

/**
 * JSON-file persistence for classification rules — configuration, not a
 * database and not log storage.
 *
 * <p><b>Safe write sequence</b> ({@link #write}):
 * <ol>
 *   <li>serialize deterministically and re-parse the bytes to validate the serialized form;
 *   <li>write a temporary file in the same directory, {@code fsync} it, close it;
 *   <li>if the current primary is valid, copy it to {@code <file>.bak} (itself via temp file + move) as the
 *       last-known-good backup; if the current primary is known to be invalid, move it aside to
 *       {@code <file>.corrupt-<timestamp>} instead — a damaged file is never silently overwritten;
 *   <li>atomically move the temporary file over the primary ({@code ATOMIC_MOVE}); where the file system does
 *       not support atomic moves, fall back to a replacing move (the backup written in step 3 still allows
 *       recovery if the process dies mid-move);
 *   <li>best-effort {@code fsync} of the directory.
 * </ol>
 * A crash at any point leaves either the old primary, the new primary, or a
 * valid backup — never a partially written primary. Callers serialize
 * writes (see {@code ClassificationRuleService}).
 */
public class ClassificationRuleRepository {

  private static final long MAX_FILE_BYTES = 16L * 1024 * 1024;

  private final Path primary;
  private final Path backup;
  private final ObjectMapper mapper;
  private final RulesSchemaMigrator migrator;
  private final Clock clock;

  public ClassificationRuleRepository(Path primary) {
    this(primary, ClassificationJson.strictMapper(), new RulesSchemaMigrator(), Clock.systemUTC());
  }

  public ClassificationRuleRepository(Path primary, ObjectMapper mapper, RulesSchemaMigrator migrator, Clock clock) {
    this.primary = primary.toAbsolutePath().normalize();
    this.backup = this.primary.resolveSibling(this.primary.getFileName() + ".bak");
    this.mapper = mapper;
    this.migrator = migrator;
    this.clock = clock;
  }

  /** Invalid or unreadable rules file. The message is safe to show and log: it never contains file content. */
  public static class RulesFileException extends RuntimeException {
    public RulesFileException(String message) {
      super(message);
    }
  }

  public Path primaryFile() {
    return primary;
  }

  public Path backupFile() {
    return backup;
  }

  public boolean primaryExists() {
    return Files.exists(primary);
  }

  public boolean backupExists() {
    return Files.exists(backup);
  }

  public RulesDocument readPrimary() {
    return read(primary);
  }

  public RulesDocument readBackup() {
    return read(backup);
  }

  private RulesDocument read(Path file) {
    byte[] bytes;
    try {
      if (Files.size(file) > MAX_FILE_BYTES) {
        throw new RulesFileException("The rules file is larger than " + MAX_FILE_BYTES + " bytes");
      }
      bytes = Files.readAllBytes(file);
    } catch (IOException e) {
      throw new RulesFileException("The rules file could not be read (" + e.getClass().getSimpleName() + ")");
    }
    JsonNode root;
    try {
      root = mapper.readTree(bytes);
    } catch (IOException e) {
      throw new RulesFileException("The rules file is not valid JSON");
    }
    if (root == null || !root.isObject()) {
      throw new RulesFileException("The rules file is not a JSON object");
    }
    if (!RulesDocument.FORMAT.equals(root.path("format").asText(null))) {
      throw new RulesFileException("The rules file has an unexpected format identifier");
    }
    ObjectNode migrated;
    try {
      migrated = migrator.migrateToCurrent((ObjectNode) root);
    } catch (RulesSchemaMigrator.UnsupportedSchemaVersionException e) {
      throw new RulesFileException(e.getMessage());
    }
    RulesDocument document;
    try {
      document = mapper.treeToValue(migrated, RulesDocument.class);
    } catch (IOException | IllegalArgumentException e) {
      throw new RulesFileException("The rules file structure is not valid");
    }
    if (document.revision() == null || document.revision() < 0) {
      throw new RulesFileException("The rules file has no valid revision");
    }
    if (document.rules().stream().anyMatch(Objects::isNull)) {
      throw new RulesFileException("The rules file contains an empty rule entry");
    }
    return document;
  }

  public void write(RulesDocument document, boolean primaryIsInvalid) throws IOException {
    Path directory = primary.getParent();
    Files.createDirectories(directory);

    byte[] json = mapper.writeValueAsBytes(document);
    byte[] bytes = Arrays.copyOf(json, json.length + 1);
    bytes[json.length] = '\n';
    RulesDocument roundTrip = mapper.readValue(bytes, RulesDocument.class);
    if (!Objects.equals(roundTrip, document)) {
      throw new IOException("Serialized rules did not round-trip");
    }

    String name = primary.getFileName().toString();
    Path temporary = directory.resolve(name + ".tmp-" + UUID.randomUUID());
    Path backupTemporary = directory.resolve(name + ".bak.tmp-" + UUID.randomUUID());
    try {
      writeSynced(temporary, bytes);
      if (Files.exists(primary)) {
        if (primaryIsInvalid) {
          String stamp = clock.instant().toString().replace(':', '-');
          Files.move(primary, directory.resolve(name + ".corrupt-" + stamp), StandardCopyOption.REPLACE_EXISTING);
        } else {
          writeSynced(backupTemporary, Files.readAllBytes(primary));
          moveReplacing(backupTemporary, backup);
        }
      }
      moveReplacing(temporary, primary);
      syncDirectory(directory);
    } finally {
      Files.deleteIfExists(temporary);
      Files.deleteIfExists(backupTemporary);
    }
  }

  private static void writeSynced(Path file, byte[] bytes) throws IOException {
    try (FileChannel channel = FileChannel.open(file, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
      ByteBuffer buffer = ByteBuffer.wrap(bytes);
      while (buffer.hasRemaining()) {
        channel.write(buffer);
      }
      channel.force(true);
    }
  }

  static void moveReplacing(Path from, Path to) throws IOException {
    try {
      Files.move(from, to, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
    } catch (AtomicMoveNotSupportedException e) {
      Files.move(from, to, StandardCopyOption.REPLACE_EXISTING);
    }
  }

  private static void syncDirectory(Path directory) {
    try (FileChannel channel = FileChannel.open(directory, StandardOpenOption.READ)) {
      channel.force(true);
    } catch (IOException | UnsupportedOperationException e) {
      // Not supported on every platform (e.g. Windows); the file itself was already fsynced.
    }
  }
}
