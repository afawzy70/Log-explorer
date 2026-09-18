import { useState } from 'react';
import { Button } from '../../shared/ui/Button';
import { DockerSettingsPanel } from './DockerSettingsPanel';
import { OpenShiftSettingsPanel } from './OpenShiftSettingsPanel';
import { PrivacyMaskingSettingsPanel } from './PrivacyMaskingSettingsPanel';
import { KeyboardShortcutsHelp } from '../../app/KeyboardShortcutsHelp';
import { SettingsNav } from './SettingsNav';
import type { SearchState } from '../../app/useSearchState';
import styles from './SettingsWorkspace.module.css';

export interface SettingsWorkspaceProps {
  state: SearchState;
  onOpenShiftScopeChanged: () => void;
  onClose: () => void;
}

/*
 * B2 (Session 4) - COMPONENT_INVENTORY.md's `app/Shell.tsx` RECOMPOSE entry: "the three settings popover
 * triggers become one Settings entry", plus the Classification rules button (deprecated separately, per
 * its own inventory row: "Replaced by Settings › Classification rules"). Section list and labels follow the
 * design's own `settingsNav()` (prototype/scripts/app.js) - Sources & connections, Privacy & masking, Field
 * mapping, Classification rules, Keyboard shortcuts. "Network proxy" (also in that nav function) is
 * deliberately NOT included: there is no such feature in this production app to route to, and inventing one
 * would be new capability work, out of scope.
 *
 * B6.2 (Session 7) - this IA (one Settings entry, persistent anchor-linked sections, never a tab switcher)
 * was already correct from Session 4 and is unchanged here. What changed is the CONTENT of the Sources &
 * connections and Privacy & masking sections: `DockerSettingsPanel`/`OpenShiftSettingsPanel`/
 * `PrivacyMaskingSettingsPanel` were each recomposed from a trigger-button popover into a persistent inline
 * `<section>` (COMPONENT_INVENTORY.md's own RECOMPOSE rows for all three) - no more "click to reveal", no
 * more `usePopoverTrigger`/`useDismissableLayer`/`role="dialog"`. Each panel now fetches its own data on
 * mount instead of on trigger-click; since a panel only ever mounts while this workspace itself is open
 * (`App.tsx`'s takeover ternary unmounts it on close), this still gives exactly one fetch per Settings visit,
 * never a background/idle fetch and never a duplicate-on-render loop. Field mapping and Classification rules
 * still open their own existing takeover workspaces exactly as before
 * (`state.openMappingWorkspace`/`state.openClassificationWorkspace`, already mutually exclusive with this
 * one - see `useSearchState.ts`) - B6.2 does not touch either of those workspaces' own content.
 */
export function SettingsWorkspace({ state, onOpenShiftScopeChanged, onClose }: SettingsWorkspaceProps) {
  // DRIFT-016 remediation - "active" section for the shared nav's own highlight, tracked from whichever
  // section last received a scroll-into-view (defaults to the first, "sources"). Purely a visual affordance;
  // every section is always in the DOM and reachable regardless of this value.
  const [activeSectionId, setActiveSectionId] = useState('sources');

  function selectSection(id: string) {
    setActiveSectionId(id);
    document.getElementById(`settings-${id}`)?.scrollIntoView({ block: 'start' });
  }

  return (
    <div className={styles.wrapper} data-testid="settings-workspace">
      <div className={styles.header}>
        <Button variant="ghost" onClick={onClose}>
          ← Back to search results
        </Button>
        <h1 className={styles.title}>Settings</h1>
      </div>
      <div className={styles.body}>
        <SettingsNav activeId={activeSectionId} onSelect={selectSection} />
        <div className={styles.content}>
          <section id="settings-sources" className={styles.section} aria-labelledby="settings-sources-heading">
            <h2 id="settings-sources-heading" className={styles.sectionHeading}>
              Sources &amp; connections
            </h2>
            <p className={styles.sectionHint}>
              Connection settings are per source. Log Explorer only reads from these sources — nothing here
              writes to Docker or OpenShift.
            </p>
            <div className={styles.sectionRow}>
              <DockerSettingsPanel />
            </div>
            <div className={styles.sectionRow}>
              <OpenShiftSettingsPanel onScopeChanged={onOpenShiftScopeChanged} />
            </div>
          </section>

          <section id="settings-masking" className={styles.section} aria-labelledby="settings-masking-heading">
            <h2 id="settings-masking-heading" className={styles.sectionHeading}>
              Privacy &amp; masking
            </h2>
            <div className={styles.sectionRow}>
              <PrivacyMaskingSettingsPanel />
            </div>
          </section>

          <section id="settings-mapping" className={styles.section} aria-labelledby="settings-mapping-heading">
            <h2 id="settings-mapping-heading" className={styles.sectionHeading}>
              Field mapping
            </h2>
            <p className={styles.sectionHint}>
              Map each canonical field to the real JSON path(s) your source uses, then verify it against real
              evidence.
            </p>
            {state.fieldMappingProfile ? (
              <p className={state.fieldMappingSearchReady ? styles.sectionStatusOk : styles.sectionStatusBlocked}>
                {state.fieldMappingSearchReady
                  ? 'Search ready.'
                  : 'Search is disabled — configure and validate log field mapping before searching this source.'}
              </p>
            ) : null}
            <div className={styles.sectionRow}>
              <Button variant="secondary" onClick={state.openMappingWorkspace}>
                Log schema &amp; field mapping
              </Button>
            </div>
          </section>

          <section
            id="settings-classification"
            className={styles.section}
            aria-labelledby="settings-classification-heading"
          >
            <h2 id="settings-classification-heading" className={styles.sectionHeading}>
              Classification rules
            </h2>
            <p className={styles.sectionHint}>
              Rules tag matching events and extract named values from them, applied by the server to every
              search.
            </p>
            {/*
             * DRIFT-016 remediation - "Manage classification rules", not the bare section title, now that
             * SettingsNav's own "Classification rules" nav item (also opening this same destination) renders
             * alongside every section including this one; same disambiguation pattern this section's own
             * "Log schema & field mapping" button above already used against its "Field mapping" nav item.
             */}
            <div className={styles.sectionRow}>
              <Button variant="secondary" onClick={state.openClassificationWorkspace}>
                Manage classification rules
              </Button>
            </div>
          </section>

          <section id="settings-shortcuts" className={styles.section} aria-labelledby="settings-shortcuts-heading">
            <h2 id="settings-shortcuts-heading" className={styles.sectionHeading}>
              Keyboard shortcuts
            </h2>
            <div className={styles.sectionRow}>
              <KeyboardShortcutsHelp />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
