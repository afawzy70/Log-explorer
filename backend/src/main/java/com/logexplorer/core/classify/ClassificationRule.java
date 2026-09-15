package com.logexplorer.core.classify;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Objects;

/**
 * A generic, user-authored event classification rule: a deterministic set
 * of conditions that assigns one or more tags to a matching event and may
 * extract user-defined structured values from it. There is no built-in
 * rule and no hard-coded rule kind — "middleware" is just a tag a user
 * chooses.
 *
 * <p>Evaluation order is deterministic ({@code priority} ascending, then
 * {@code id}); every enabled rule that matches contributes its own result —
 * evaluation never stops at the first match.
 *
 * <p>Boxed fields are nullable on the wire so a missing value can be given
 * its documented default in {@link #normalized()}, instead of silently
 * becoming {@code false}/{@code 0}.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ClassificationRule(
    String id,
    String name,
    String description,
    List<String> tags,
    Boolean enabled,
    Integer priority,
    MatchMode matchMode,
    List<RuleCondition> conditions,
    List<ExtractionDefinition> extractions,
    Instant createdAt,
    Instant updatedAt
) {

  public static final int DEFAULT_PRIORITY = 100;

  public ClassificationRule normalized() {
    LinkedHashSet<String> normalizedTags = new LinkedHashSet<>();
    if (tags != null) {
      for (String tag : tags) {
        if (tag != null && !tag.isBlank()) {
          normalizedTags.add(tag.trim().toLowerCase(Locale.ROOT));
        }
      }
    }
    return new ClassificationRule(
        ExtractionDefinition.blankToNull(id),
        name == null ? null : name.trim(),
        description == null ? "" : description.trim(),
        List.copyOf(normalizedTags),
        enabled == null ? Boolean.TRUE : enabled,
        priority == null ? DEFAULT_PRIORITY : priority,
        matchMode == null ? MatchMode.ALL : matchMode,
        conditions == null ? List.of() : conditions.stream().map(c -> c == null ? null : c.normalized()).toList(),
        extractions == null ? List.of() : extractions.stream().map(x -> x == null ? null : x.normalized()).toList(),
        createdAt,
        updatedAt);
  }

  public ClassificationRule withId(String newId) {
    return new ClassificationRule(newId, name, description, tags, enabled, priority, matchMode, conditions, extractions,
        createdAt, updatedAt);
  }

  public ClassificationRule withMetadata(Instant created, Instant updated) {
    return new ClassificationRule(id, name, description, tags, enabled, priority, matchMode, conditions, extractions,
        created, updated);
  }

  public ClassificationRule withoutMetadata() {
    return withMetadata(null, null);
  }

  /** Same rule content, ignoring created/updated metadata — the definition of an "identical" imported rule. */
  public boolean sameContentAs(ClassificationRule other) {
    return other != null && Objects.equals(normalized().withoutMetadata(), other.normalized().withoutMetadata());
  }

  public boolean isEnabled() {
    return enabled == null || enabled;
  }

  public int effectivePriority() {
    return priority == null ? DEFAULT_PRIORITY : priority;
  }
}
