import type { ReactNode } from 'react';
import styles from './InspectorSection.module.css';

/** One titled section - every inspector section shares this shell so heading levels/spacing stay consistent. */
export function InspectorSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section} aria-label={title}>
      <h2 className={styles.heading}>{title}</h2>
      {children}
    </section>
  );
}

/**
 * UX-R5 §13 - a titled section that starts collapsed, for the one section
 * that is an *escape hatch* rather than an investigation surface.
 *
 * <p>Measured motivation: "All fields" rendered 1,895px tall - 47% of the
 * whole inspector's 3,992px scroll height, and more than Overview, Actor
 * & client, Request flow and Business / error put together. A canonical
 * dump of every field is genuinely valuable and must stay reachable
 * (§13), but it is what an investigator opens when the structured views
 * did not answer the question - it should not be the thing they scroll
 * through to reach anything else. `<details>`/`<summary>` gives that for
 * free: keyboard operable, exposed as expandable to assistive technology
 * via native semantics, and findable because the heading is still always
 * visible.
 */
export function CollapsibleInspectorSection({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <details className={styles.section}>
      {/*
        * A real `<h2>` inside the `<summary>`, matching `InspectorSection`'s
        * own heading level: collapsing a section must not drop it out of
        * the document's heading outline, which is how a screen-reader user
        * navigates the panel. `<details>`/`<summary>` already conveys the
        * expanded/collapsed state natively - no `aria-expanded` of our own.
        */}
      <summary className={styles.summary}>
        <h2 className={styles.heading}>{title}</h2>
        {hint ? <span className={styles.summaryHint}>{hint}</span> : null}
      </summary>
      <div className={styles.collapsibleBody}>{children}</div>
    </details>
  );
}

/** Shown instead of an empty section body - never just a bare heading with nothing under it. */
export function EmptySectionNote({ children }: { children: ReactNode }) {
  return <p className={styles.emptyNote}>{children}</p>;
}
