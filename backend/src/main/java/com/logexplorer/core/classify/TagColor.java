package com.logexplorer.core.classify;

import java.util.Locale;

/**
 * The controlled semantic palette a classification rule's tags are drawn in
 * (owner mission "Classification real search scope, assisted extraction,
 * and visual tagging" §"Color model").
 *
 * <p>Deliberately a closed enum of stable names, never a CSS value: the
 * server persists and exports {@code "BLUE"}, and each client decides how
 * blue looks in its own theme. A pack written by another installation can
 * therefore never inject styling, and a rules file stays readable and
 * portable.
 *
 * <p>Colour is identity only — it never means severity, success, failure or
 * causality, and it is never the only signal: every chip carries its tag
 * text (CLAUDE.md §7 "non-color meaning").
 */
public enum TagColor {
  GRAY,
  BLUE,
  CYAN,
  GREEN,
  AMBER,
  ORANGE,
  RED,
  PURPLE;

  /**
   * The deterministic default for a rule that chose no colour: derived from
   * the rule's first tag, so the same tag name always lands on the same
   * colour on every installation, in every pack, without anything being
   * stored. Colour choice is optional, and a rules file written before this
   * field existed keeps loading — it simply gets this default.
   *
   * <p>{@link #GRAY} is reserved for a rule with no tag at all, so it never
   * competes with a derived colour.
   */
  public static TagColor defaultFor(String tag) {
    if (tag == null || tag.isBlank()) {
      return GRAY;
    }
    String normalized = tag.trim().toLowerCase(Locale.ROOT);
    int hash = 0;
    for (int i = 0; i < normalized.length(); i++) {
      hash = 31 * hash + normalized.charAt(i);
    }
    TagColor[] derivable = {BLUE, CYAN, GREEN, AMBER, ORANGE, RED, PURPLE};
    return derivable[Math.floorMod(hash, derivable.length)];
  }
}
