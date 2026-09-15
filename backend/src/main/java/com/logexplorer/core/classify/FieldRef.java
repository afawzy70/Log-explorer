package com.logexplorer.core.classify;

import com.logexplorer.core.model.CanonicalLogEvent;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/**
 * A reference to one field of a canonical event, as written in a rule:
 * <ul>
 *   <li>a canonical field name ({@code message}, {@code service}, {@code
 *       logger}, {@code businessStep}, {@code errorCode}, ...) — whatever
 *       the active field mapping resolved, so rules never bypass mapping;
 *   <li>{@code extra.<key>} — an unmapped top-level JSON field the parser
 *       preserved;
 *   <li>{@code mdc.<key>} — an unmapped MDC field the parser preserved.
 * </ul>
 *
 * <p>The five protected identifiers (CIF, username, customer ID, device ID,
 * device IP) are deliberately not addressable: a rule must never become a
 * side channel around the masking boundary.
 */
public final class FieldRef {

  public static final String EXTRA_PREFIX = "extra.";
  public static final String MDC_PREFIX = "mdc.";
  private static final int MAX_KEY_LENGTH = 120;

  public record FieldOption(String key, String label) {
  }

  private record Canonical(String label, Function<CanonicalLogEvent, Object> accessor) {
  }

  private static final Map<String, Canonical> CANONICAL = new LinkedHashMap<>();

  static {
    CANONICAL.put("message", new Canonical("Message", CanonicalLogEvent::message));
    CANONICAL.put("service", new Canonical("Service", CanonicalLogEvent::service));
    CANONICAL.put("severity", new Canonical("Severity", CanonicalLogEvent::severity));
    CANONICAL.put("logger", new Canonical("Logger", CanonicalLogEvent::logger));
    CANONICAL.put("thread", new Canonical("Thread", CanonicalLogEvent::thread));
    CANONICAL.put("exception", new Canonical("Exception", CanonicalLogEvent::exception));
    CANONICAL.put("businessStep", new Canonical("Business step", CanonicalLogEvent::businessStep));
    CANONICAL.put("errorCode", new Canonical("Error code", CanonicalLogEvent::errorCode));
    CANONICAL.put("uiIdentifier", new Canonical("UI identifier", CanonicalLogEvent::uiIdentifier));
    CANONICAL.put("journeyName", new Canonical("Journey name", CanonicalLogEvent::journeyName));
    CANONICAL.put("traceId", new Canonical("Trace ID", CanonicalLogEvent::traceId));
    CANONICAL.put("spanId", new Canonical("Span ID", CanonicalLogEvent::spanId));
    CANONICAL.put("correlationId", new Canonical("Correlation ID", CanonicalLogEvent::correlationId));
    CANONICAL.put("journeyId", new Canonical("Journey ID", CanonicalLogEvent::journeyId));
    CANONICAL.put("eventId", new Canonical("Event ID", CanonicalLogEvent::eventId));
    CANONICAL.put("devicePlatformType", new Canonical("Device platform", CanonicalLogEvent::devicePlatformType));
    CANONICAL.put("language", new Canonical("Language", CanonicalLogEvent::language));
    CANONICAL.put("serverHost", new Canonical("Server host", CanonicalLogEvent::serverHost));
    CANONICAL.put("serverIp", new Canonical("Server IP", CanonicalLogEvent::serverIp));
    CANONICAL.put("rawLine", new Canonical("Raw line (malformed events)", CanonicalLogEvent::rawLine));
  }

  private final String raw;
  private final Function<CanonicalLogEvent, Object> accessor;

  private FieldRef(String raw, Function<CanonicalLogEvent, Object> accessor) {
    this.raw = raw;
    this.accessor = accessor;
  }

  /**
   * @throws IllegalArgumentException with a user-facing message when the reference is not addressable
   */
  public static FieldRef parse(String raw) {
    if (raw == null || raw.isBlank()) {
      throw new IllegalArgumentException("A field is required");
    }
    String ref = raw.trim();
    Canonical canonical = CANONICAL.get(ref);
    if (canonical != null) {
      return new FieldRef(ref, canonical.accessor());
    }
    if (ref.startsWith(EXTRA_PREFIX)) {
      String key = validKey(ref.substring(EXTRA_PREFIX.length()));
      return new FieldRef(ref, e -> e.unknownTopLevelFields().get(key));
    }
    if (ref.startsWith(MDC_PREFIX)) {
      String key = validKey(ref.substring(MDC_PREFIX.length()));
      return new FieldRef(ref, e -> e.unknownMdcFields().get(key));
    }
    throw new IllegalArgumentException(
        "Unknown field. Use a canonical field (for example message), extra.<key>, or mdc.<key>");
  }

  private static String validKey(String key) {
    if (key.isEmpty() || key.length() > MAX_KEY_LENGTH || key.chars().anyMatch(Character::isWhitespace)) {
      throw new IllegalArgumentException("Field keys must be 1-" + MAX_KEY_LENGTH + " characters without spaces");
    }
    return key;
  }

  public Object resolve(CanonicalLogEvent event) {
    return event == null ? null : accessor.apply(event);
  }

  public String raw() {
    return raw;
  }

  public static List<FieldOption> canonicalOptions() {
    List<FieldOption> options = new ArrayList<>(CANONICAL.size());
    CANONICAL.forEach((key, canonical) -> options.add(new FieldOption(key, canonical.label())));
    return List.copyOf(options);
  }

  @Override
  public String toString() {
    return raw;
  }
}
