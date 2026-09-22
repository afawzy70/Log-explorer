import type { RuleMatchDto, TagColor } from '../api/types';
import styles from './TagChip.module.css';

const COLOR_CLASS: Record<TagColor, string> = {
  GRAY: styles.gray,
  BLUE: styles.blue,
  CYAN: styles.cyan,
  GREEN: styles.green,
  AMBER: styles.amber,
  ORANGE: styles.orange,
  RED: styles.red,
  PURPLE: styles.purple,
};

export interface TagChipProps {
  tag: string;
  color?: TagColor | null;
  /** Rendered instead of the tag name (e.g. the colour picker's swatch labels - "Blue", "Purple" - which still need their own accessible label). Overflow counts use `TagCountBadge` below, never this prop. */
  label?: string;
  title?: string;
}

/**
 * One classification tag - B1 chip grammar (tinted pill + hue dot + neutral text,
 * `DESIGN_SYSTEM.md` §22.2/§22.11 A4): the dot is drawn by `.chip::before` in CSS,
 * carrying no accessible content of its own. The tag text is always rendered -
 * colour is identity only and never the sole signal (CLAUDE.md §7), so the chip
 * stays meaningful without colour vision, in forced-colours mode, and in print.
 */
export function TagChip({ tag, color, label, title }: TagChipProps) {
  const className = `${styles.chip} ${COLOR_CLASS[color ?? 'GRAY'] ?? styles.gray}`;
  return (
    <span className={className} title={title ?? tag} data-tag-color={color ?? 'GRAY'}>
      <span className={styles.text}>{label ?? tag}</span>
    </span>
  );
}

export interface TagCountBadgeProps {
  count: number;
  title?: string;
}

/**
 * The "+N" overflow counter for a truncated tag list (e.g. the Results table's
 * Tags column, `columnRegistry.tsx`). Deliberately NOT a coloured `TagChip`
 * (§22.11 A3 - a prior defect this restyle corrects): it counts identities, it
 * is not one, so it stays neutral - `data-tag-color` is intentionally absent,
 * distinguishing it from a real tag chip for anything (a test, an assistive
 * technology heuristic) that keys off that attribute.
 */
export function TagCountBadge({ count, title }: TagCountBadgeProps) {
  return (
    <span className={styles.countBadge} title={title}>
      {`+${count}`}
    </span>
  );
}

/**
 * The colour each tag of an event resolves to, taken from the rules that actually matched it. The server keeps one
 * colour per tag, so two matching rules can never disagree about the same tag.
 */
export function tagColorsOf(classifications: RuleMatchDto[] | undefined): Record<string, TagColor> {
  const colors: Record<string, TagColor> = {};
  for (const classification of classifications ?? []) {
    for (const tag of classification.tags) {
      if (!colors[tag] && classification.displayColor) {
        colors[tag] = classification.displayColor;
      }
    }
  }
  return colors;
}
