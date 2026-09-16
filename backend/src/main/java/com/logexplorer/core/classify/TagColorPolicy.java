package com.logexplorer.core.classify;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The deterministic rule behind "the same tag is always drawn in the same
 * colour" (owner mission "Classification real search scope, assisted
 * extraction, and visual tagging" §"Color consistency / same tag").
 *
 * <p>Within one saved rule set, a normalized tag name resolves to exactly
 * one {@link TagColor}. Two rules that both tag {@code middleware} but ask
 * for different colours are a <b>conflict</b>: it is reported and the write
 * is rejected, never silently resolved by picking a winner — the user
 * decides, by changing one of the two colours (or, on import, by keeping
 * the existing rule or replacing all rules).
 *
 * <p>Rules that choose no colour cannot conflict with each other: the
 * default is derived from the tag itself ({@link TagColor#defaultFor}), so
 * a tag without explicit colours is identical everywhere.
 */
public final class TagColorPolicy {

  private TagColorPolicy() {
  }

  /** The one colour each tag resolves to, in first-seen order. */
  public static Map<String, TagColor> tagColors(List<ClassificationRule> rules) {
    Map<String, TagColor> colors = new LinkedHashMap<>();
    for (ClassificationRule rule : rules) {
      if (rule == null || rule.tags() == null) {
        continue;
      }
      TagColor color = rule.effectiveDisplayColor();
      for (String tag : rule.tags()) {
        colors.putIfAbsent(tag, color);
      }
    }
    return colors;
  }

  /**
   * Every tag a later rule would draw in a different colour than an earlier
   * one, as validation errors pointing at the later rule's own colour.
   * Empty when the set is consistent.
   */
  public static List<RuleValidationError> conflicts(List<ClassificationRule> rules) {
    Map<String, TagColor> claimed = new LinkedHashMap<>();
    Map<String, String> claimedBy = new LinkedHashMap<>();
    List<RuleValidationError> errors = new ArrayList<>();
    for (int i = 0; i < rules.size(); i++) {
      ClassificationRule rule = rules.get(i);
      if (rule == null || rule.tags() == null) {
        continue;
      }
      TagColor color = rule.effectiveDisplayColor();
      for (String tag : rule.tags()) {
        TagColor existing = claimed.get(tag);
        if (existing == null) {
          claimed.put(tag, color);
          claimedBy.put(tag, describe(rule));
        } else if (existing != color) {
          errors.add(new RuleValidationError("rules[" + i + "].displayColor",
              "Tag \"" + tag + "\" is already shown in " + existing + " by " + claimedBy.get(tag)
                  + ". Every rule that uses a tag must show it in the same colour — change one of the two colours."));
        }
      }
    }
    return errors;
  }

  private static String describe(ClassificationRule rule) {
    String name = rule.name() == null || rule.name().isBlank() ? rule.id() : rule.name();
    return name == null ? "another rule" : "\"" + name + "\"";
  }
}
