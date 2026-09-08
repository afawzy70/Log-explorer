import styles from './FieldList.module.css';

export interface FieldItem {
  label: string;
  value: string;
  monospace?: boolean;
}

/**
 * A definition-list of label/value pairs - the one rendering primitive
 * every inspector section built from `FieldItem[]` shares, so every
 * section's label/value geometry stays consistent (CLAUDE.md §7:
 * "consistent"). Text content only, always (CLAUDE.md §2 rule 3: no
 * `dangerouslySetInnerHTML` - log content renders as text).
 */
export function FieldList({ items }: { items: FieldItem[] }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <dl className={styles.list}>
      {items.map((item) => (
        <div className={styles.row} key={item.label}>
          <dt className={styles.label}>{item.label}</dt>
          <dd className={[styles.value, item.monospace ? styles.mono : ''].filter(Boolean).join(' ')}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
