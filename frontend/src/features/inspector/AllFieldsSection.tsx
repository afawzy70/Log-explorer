import { useState } from 'react';
import type { LogEvent, SourceInfo } from '../../shared/api/types';
import { FieldList } from '../../shared/ui/FieldList';
import { buildCanonicalFieldEntries, buildUnknownFieldEntries, filterFieldEntries } from './allFields';
import { EmptySectionNote, InspectorSection } from './InspectorSection';
import styles from './AllFieldsSection.module.css';

/**
 * "All fields" (HANDOVER.md §16.6): searchable key/value view, canonical
 * first, unknown after, raw JSON behind a further `<details>` disclosure.
 * Text rendering only throughout - `<pre>{JSON.stringify(...)}</pre>` is
 * a single text node, never `dangerouslySetInnerHTML` (CLAUDE.md §2 rule
 * 3). Masked values stay masked because `event` itself only ever carries
 * already-masked sensitive fields (see `LogEvent`'s own type comment) -
 * `JSON.stringify(event)` cannot leak anything raw the event doesn't have.
 */
export function AllFieldsSection({ event, sources }: { event: LogEvent; sources: SourceInfo[] }) {
  const [query, setQuery] = useState('');
  const canonical = filterFieldEntries(buildCanonicalFieldEntries(event, sources), query);
  const unknown = filterFieldEntries(buildUnknownFieldEntries(event), query);

  return (
    <InspectorSection title="All fields">
      <label className={styles.searchLabel} htmlFor="inspector-all-fields-search">
        Search fields
      </label>
      <input
        id="inspector-all-fields-search"
        type="search"
        className={styles.search}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter by field name or value…"
      />
      {canonical.length === 0 && unknown.length === 0 ? (
        <EmptySectionNote>No fields match "{query}".</EmptySectionNote>
      ) : (
        <>
          {canonical.length > 0 ? <FieldList items={canonical} /> : null}
          {unknown.length > 0 ? (
            <div className={styles.unknownGroup}>
              <p className={styles.unknownHeading}>Unknown fields</p>
              <FieldList items={unknown} />
            </div>
          ) : null}
        </>
      )}
      <details className={styles.rawJson}>
        <summary>Raw JSON</summary>
        <pre className={styles.rawJsonBody}>{JSON.stringify(event, null, 2)}</pre>
      </details>
    </InspectorSection>
  );
}
