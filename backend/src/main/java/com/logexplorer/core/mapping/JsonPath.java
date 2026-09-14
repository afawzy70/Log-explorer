package com.logexplorer.core.mapping;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Objects;

/**
 * A deterministic, non-executable field path into a parsed JSON object tree
 * (owner mission §21: "Use a deterministic safe JSON-path mechanism. Do NOT
 * use arbitrary executable expressions. No eval. No scripting.").
 *
 * <p><b>Supported syntax</b> (documented here per mission §21's explicit
 * requirement):
 * <ul>
 *   <li>A bare segment ({@code cif}, {@code mdc}, {@code stepName}) is a
 *       plain object-key traversal step.</li>
 *   <li>Segments are separated by a single {@code .} — {@code mdc.cif} means
 *       "the value at key {@code mdc}, then the value at key {@code cif}
 *       inside that."</li>
 *   <li>A segment written as {@code ["literal.key"]} (double quotes,
 *       required) is a <b>literal</b> key — used when the real JSON key
 *       itself contains a {@code .} and must not be split into nested
 *       segments. This exactly generalizes the one hand-written case
 *       {@code core.parse.LogLineParser} already had for {@code
 *       mdc["event.correlationId"]} (a flat key containing a dot, not a
 *       nested {@code event -> correlationId} path) — see {@link
 *       JsonPathResolver} for the resolution semantics this preserves
 *       exactly.</li>
 *   <li>A path may mix the two: {@code mdc["event.correlationId"]} is
 *       segment {@code mdc} then literal segment {@code event.correlationId}.</li>
 * </ul>
 *
 * <p>Nothing here ever evaluates a string as code. Parsing is a small,
 * fixed hand-written tokenizer with no dynamic dispatch on the input. An
 * invalid path (unterminated bracket/quote, empty segment, trailing dot)
 * throws {@link InvalidJsonPathException} — callers must treat this as a
 * data-validation error (mission §21: "Invalid paths must fail safely"),
 * never propagate it as a 500.
 */
public final class JsonPath {

  private final String raw;
  private final List<String> segments;

  private JsonPath(String raw, List<String> segments) {
    this.raw = raw;
    this.segments = Collections.unmodifiableList(segments);
  }

  public String raw() {
    return raw;
  }

  /** The resolved, unescaped path segments in traversal order. Never empty for a valid path. */
  public List<String> segments() {
    return segments;
  }

  public static JsonPath parse(String raw) {
    if (raw == null || raw.isBlank()) {
      throw new InvalidJsonPathException("Path must not be blank");
    }
    String trimmed = raw.trim();
    List<String> segments = new ArrayList<>();
    int i = 0;
    int len = trimmed.length();

    while (i < len) {
      char c = trimmed.charAt(i);
      if (c == '.') {
        throw new InvalidJsonPathException("Unexpected '.' in path (empty segment): " + raw);
      }
      if (c == ']') {
        throw new InvalidJsonPathException("Unexpected ']' in path: " + raw);
      }
      if (c == '[') {
        int closeBracket = trimmed.indexOf(']', i);
        if (closeBracket < 0) {
          throw new InvalidJsonPathException("Unterminated '[' in path: " + raw);
        }
        String inner = trimmed.substring(i + 1, closeBracket);
        if (inner.length() < 2 || inner.charAt(0) != '"' || inner.charAt(inner.length() - 1) != '"') {
          throw new InvalidJsonPathException(
              "Bracketed segment must be a double-quoted literal key, e.g. [\"event.correlationId\"]: " + raw);
        }
        String literal = inner.substring(1, inner.length() - 1);
        if (literal.isEmpty()) {
          throw new InvalidJsonPathException("Literal key segment must not be empty: " + raw);
        }
        segments.add(literal);
        i = closeBracket + 1;
      } else {
        // A plain segment runs until the next '.', '[', or end of string.
        int start = i;
        while (i < len && trimmed.charAt(i) != '.' && trimmed.charAt(i) != '[') {
          if (trimmed.charAt(i) == ']') {
            throw new InvalidJsonPathException("Unexpected ']' in path: " + raw);
          }
          i++;
        }
        segments.add(trimmed.substring(start, i));
      }
      // A '.' separator is consumed and requires another segment to follow;
      // a following '[' starts an adjacent bracket segment with no
      // separator needed (mdc["event.correlationId"] = segment "mdc" then
      // literal segment "event.correlationId", not "mdc" + "." + literal).
      if (i < len && trimmed.charAt(i) == '.') {
        i++;
        if (i >= len) {
          throw new InvalidJsonPathException("Path must not end with '.': " + raw);
        }
      }
    }
    if (segments.isEmpty()) {
      throw new InvalidJsonPathException("Path resolved to zero segments: " + raw);
    }
    return new JsonPath(trimmed, segments);
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (!(o instanceof JsonPath other)) {
      return false;
    }
    return segments.equals(other.segments);
  }

  @Override
  public int hashCode() {
    return Objects.hash(segments);
  }

  @Override
  public String toString() {
    return raw;
  }
}
