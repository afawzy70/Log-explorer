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
  /** Rendered instead of the tag name (for the "+2" overflow chip), which still needs its own accessible label. */
  label?: string;
  title?: string;
}

/**
 * One classification tag. The tag text is always rendered - colour is identity only and never the sole signal
 * (CLAUDE.md §7), so the chip stays meaningful without colour vision, in forced-colours mode, and in print.
 */
export function TagChip({ tag, color, label, title }: TagChipProps) {
  const className = `${styles.chip} ${COLOR_CLASS[color ?? 'GRAY'] ?? styles.gray}`;
  return (
    <span className={className} title={title ?? tag} data-tag-color={color ?? 'GRAY'}>
      {label ?? tag}
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
