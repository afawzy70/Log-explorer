import type { ReactNode } from 'react';
import styles from './InspectorSection.module.css';

/** One collapsible-free titled section - every inspector section shares this shell so heading levels/spacing stay consistent. */
export function InspectorSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section} aria-label={title}>
      <h2 className={styles.heading}>{title}</h2>
      {children}
    </section>
  );
}

/** Shown instead of an empty section body - never just a bare heading with nothing under it. */
export function EmptySectionNote({ children }: { children: ReactNode }) {
  return <p className={styles.emptyNote}>{children}</p>;
}
