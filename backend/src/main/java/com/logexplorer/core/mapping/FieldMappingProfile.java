package com.logexplorer.core.mapping;

import java.util.ArrayList;
import java.util.Collections;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * An immutable, ordered field-mapping profile: for each {@link
 * CanonicalField}, zero or more candidate {@link JsonPath}s in precedence
 * order (mission §10 — "A canonical field must be able to map to MORE THAN
 * ONE source path in ordered precedence... First usable non-null value
 * wins.").
 *
 * <p>A field with zero candidates is a deliberate, honest "not yet mapped"
 * state (mission §11 — new fields like {@link CanonicalField#JOURNEY_NAME}
 * ship with no default candidate rather than an invented/guessed one) —
 * distinct from a field whose only candidate simply doesn't resolve for a
 * given event.
 *
 * <p>Scope note (mission §13): this mission's minimum implementation is one
 * active profile (the built-in default, or the single user override layered
 * on it) — not yet per-source/per-application profiles. Carrying an {@code
 * id}/{@code name} here (rather than a bare {@code Map}) is deliberate
 * future-proofing so a later mission can introduce multiple named profiles
 * (e.g. "Docker / IAM", "OpenShift / Production") without redesigning this
 * type — see {@code FieldMappingProfileService}'s own javadoc for the exact
 * boundary of what is and isn't built now.
 */
public final class FieldMappingProfile {

  private final String id;
  private final String name;
  private final Map<CanonicalField, List<JsonPath>> candidates;

  private FieldMappingProfile(String id, String name, Map<CanonicalField, List<JsonPath>> candidates) {
    this.id = id;
    this.name = name;
    Map<CanonicalField, List<JsonPath>> copy = new EnumMap<>(CanonicalField.class);
    for (CanonicalField field : CanonicalField.values()) {
      List<JsonPath> paths = candidates.getOrDefault(field, List.of());
      copy.put(field, Collections.unmodifiableList(new ArrayList<>(paths)));
    }
    this.candidates = Collections.unmodifiableMap(copy);
  }

  public static FieldMappingProfile of(String id, String name, Map<CanonicalField, List<JsonPath>> candidates) {
    return new FieldMappingProfile(id, name, candidates);
  }

  public String id() {
    return id;
  }

  public String name() {
    return name;
  }

  /** Ordered candidate paths for {@code field} — never {@code null}, may be empty. */
  public List<JsonPath> candidates(CanonicalField field) {
    return candidates.get(field);
  }

  public Map<CanonicalField, List<JsonPath>> allCandidates() {
    return candidates;
  }

  /** A copy of this profile with {@code field}'s candidate list replaced. */
  public FieldMappingProfile withCandidates(CanonicalField field, List<JsonPath> newCandidates) {
    Map<CanonicalField, List<JsonPath>> copy = new EnumMap<>(candidates);
    copy.put(field, newCandidates == null ? List.of() : newCandidates);
    return new FieldMappingProfile(id, name, copy);
  }

  public FieldMappingProfile withName(String newName) {
    return new FieldMappingProfile(id, newName, candidates);
  }
}
