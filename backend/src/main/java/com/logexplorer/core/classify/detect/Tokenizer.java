package com.logexplorer.core.classify.detect;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Deterministic structural tokenizer for pattern detection. Splits a value
 * on whitespace, separates {@code label=value}/{@code label: value} pairs,
 * and classifies each chunk as fixed text ({@code WORD}, {@code LABEL}) or
 * a likely-variable shape (numbers, durations, UUIDs, hex IDs, mixed
 * IDs, URLs, paths, timestamps, IPs, quoted strings, redaction markers).
 * All patterns are fixed and anchored, applied to short whitespace-free
 * chunks only.
 */
final class Tokenizer {

  enum Kind { WORD, LABEL, NUMBER, DURATION, UUID, HEX, ID, URL, PATH, TIMESTAMP, IP, QUOTED, REDACTED }

  record Token(String text, Kind kind, int start, int end, String label) {
    boolean literal() {
      return kind == Kind.WORD || kind == Kind.LABEL;
    }
  }

  private static final Pattern LABEL_VALUE = Pattern.compile("^([A-Za-z_][A-Za-z0-9_.\\-]{0,40})([=:])(.+)$");
  private static final Pattern LABEL_ONLY = Pattern.compile("^([A-Za-z_][A-Za-z0-9_.\\-]{0,40})[=:]$");
  private static final Pattern TRAILING_PUNCTUATION = Pattern.compile("[,;.)\\]}]+$");
  private static final Pattern TIMESTAMP = Pattern.compile(
      "^\\d{4}-\\d{2}-\\d{2}(?:[T ]\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:?\\d{2})?)?$");
  private static final Pattern UUID = Pattern.compile(
      "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");
  private static final Pattern IP = Pattern.compile("^\\d{1,3}(?:\\.\\d{1,3}){3}(?::\\d{1,5})?$");
  private static final Pattern DURATION = Pattern.compile("^\\d+(?:\\.\\d+)?(?:ns|us|µs|ms|s|m|h)$");
  private static final Pattern NUMBER = Pattern.compile("^[-+]?\\d+(?:\\.\\d+)?%?$");
  private static final Pattern URL = Pattern.compile("^[A-Za-z][A-Za-z0-9+.\\-]*://\\S+$");
  private static final Pattern PATH = Pattern.compile("^/\\S*$");
  private static final Pattern HEX = Pattern.compile("^(?:0x)?[0-9a-fA-F]{8,}$");
  private static final Pattern HAS_DIGIT = Pattern.compile("\\d");
  private static final Pattern HAS_LETTER = Pattern.compile("[A-Za-z]");

  private Tokenizer() {
  }

  static List<Token> tokenize(String value, int maxTokens) {
    List<Token> tokens = new ArrayList<>();
    int length = value.length();
    int i = 0;
    String pendingLabel = null;
    while (i < length && tokens.size() < maxTokens) {
      while (i < length && Character.isWhitespace(value.charAt(i))) {
        i++;
      }
      if (i >= length) {
        break;
      }
      int start = i;
      while (i < length && !Character.isWhitespace(value.charAt(i))) {
        i++;
      }
      String chunk = value.substring(start, i);
      if (chunk.contains("[REDACTED")) {
        tokens.add(new Token(chunk, Kind.REDACTED, start, i, pendingLabel));
        pendingLabel = null;
        continue;
      }
      Matcher labelValue = LABEL_VALUE.matcher(chunk);
      if (labelValue.matches() && !(labelValue.group(2).equals(":") && labelValue.group(3).startsWith("//"))) {
        int labelEnd = start + labelValue.end(2);
        tokens.add(new Token(chunk.substring(0, labelValue.end(2)), Kind.LABEL, start, labelEnd, null));
        String rest = labelValue.group(3);
        if (tokens.size() < maxTokens) {
          tokens.add(new Token(rest, rest.contains("[REDACTED") ? Kind.REDACTED : classify(rest), labelEnd, i,
              labelValue.group(1)));
        }
        pendingLabel = null;
        continue;
      }
      Matcher labelOnly = LABEL_ONLY.matcher(chunk);
      if (labelOnly.matches()) {
        tokens.add(new Token(chunk, Kind.LABEL, start, i, null));
        pendingLabel = labelOnly.group(1);
        continue;
      }
      tokens.add(new Token(chunk, classify(chunk), start, i, pendingLabel));
      pendingLabel = null;
    }
    return tokens;
  }

  static Kind classify(String raw) {
    String core = TRAILING_PUNCTUATION.matcher(raw).replaceAll("");
    if (core.isEmpty()) {
      return Kind.WORD;
    }
    if (core.length() >= 2 && (core.charAt(0) == '"' || core.charAt(0) == '\'')) {
      return Kind.QUOTED;
    }
    if (TIMESTAMP.matcher(core).matches()) {
      return Kind.TIMESTAMP;
    }
    if (UUID.matcher(core).matches()) {
      return Kind.UUID;
    }
    if (IP.matcher(core).matches()) {
      return Kind.IP;
    }
    if (DURATION.matcher(core).matches()) {
      return Kind.DURATION;
    }
    if (NUMBER.matcher(core).matches()) {
      return Kind.NUMBER;
    }
    if (URL.matcher(core).matches()) {
      return Kind.URL;
    }
    if (PATH.matcher(core).matches()) {
      return Kind.PATH;
    }
    boolean hasDigit = HAS_DIGIT.matcher(core).find();
    if (hasDigit && HEX.matcher(core).matches()) {
      return Kind.HEX;
    }
    if (hasDigit && core.length() >= 3 && HAS_LETTER.matcher(core).find()) {
      return Kind.ID;
    }
    return Kind.WORD;
  }
}
