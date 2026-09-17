import { Button } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { DockerSettingsPanel } from './DockerSettingsPanel';
import { OpenShiftSettingsPanel } from './OpenShiftSettingsPanel';
import { PrivacyMaskingSettingsPanel } from './PrivacyMaskingSettingsPanel';
import { KeyboardShortcutsHelp } from '../../app/KeyboardShortcutsHelp';
import type { SearchState } from '../../app/useSearchState';
import styles from './SettingsWorkspace.module.css';

export interface SettingsWorkspaceProps {
  state: SearchState;
  onOpenShiftScopeChanged: () => void;
  onClose: () => void;
}

interface NavSection {
  id: string;
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
}

/*
 * B2 (Session 4) - COMPONENT_INVENTORY.md's `app/Shell.tsx` RECOMPOSE entry: "the three settings popover
 * triggers become one Settings entry", plus the Classification rules button (deprecated separately, per
 * its own inventory row: "Replaced by Settings › Classification rules"). Section list and labels follow the
 * design's own `settingsNav()` (prototype/scripts/app.js) - Sources & connections, Privacy & masking, Field
 * mapping, Classification rules, Keyboard shortcuts. "Network proxy" (also in that nav function) is
 * deliberately NOT included: there is no such feature in this production app to route to, and inventing one
 * would be B6 settings-CONTENT work, explicitly out of scope for this bounded shell-routing recompose.
 *
 * IA recompose only - every section below renders the EXISTING, unmodified panel component. None of
 * DockerSettingsPanel/OpenShiftSettingsPanel/PrivacyMaskingSettingsPanel's ~1450 lines of internal logic,
 * markup, or backend-settings semantics changed even slightly; each is still exactly the same self-contained
 * "trigger button that opens its own popover" component it always was (confirmed safe to relocate: each
 * panel's own popover is `position: absolute` relative to ITS OWN `position: relative` wrapper, never
 * dependent on being a direct child of the old header). Field mapping and Classification rules open their
 * own existing takeover workspaces exactly as their old standalone Shell buttons did (`state.openMappingWorkspace`/
 * `state.openClassificationWorkspace`, already mutually exclusive with this one - see `useSearchState.ts`).
 */
const NAV_SECTIONS: NavSection[] = [
  { id: 'sources', icon: 'database', label: 'Sources & connections' },
  { id: 'masking', icon: 'shield-check', label: 'Privacy & masking' },
  { id: 'mapping', icon: 'scan-search', label: 'Field mapping' },
  { id: 'classification', icon: 'tags', label: 'Classification rules' },
  { id: 'shortcuts', icon: 'keyboard', label: 'Keyboard shortcuts' },
];

export function SettingsWorkspace({ state, onOpenShiftScopeChanged, onClose }: SettingsWorkspaceProps) {
  return (
    <div className={styles.wrapper} data-testid="settings-workspace">
      <div className={styles.header}>
        <Button variant="ghost" onClick={onClose}>
          ← Back to search results
        </Button>
        <h1 className={styles.title}>Settings</h1>
      </div>
      <div className={styles.body}>
        <nav className={styles.nav} aria-label="Settings sections">
          {NAV_SECTIONS.map((section) => (
            <a key={section.id} href={`#settings-${section.id}`} className={styles.navItem}>
              <Icon name={section.icon} size="sm" />
              {section.label}
            </a>
          ))}
        </nav>
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
            <div className={styles.sectionRow}>
              <Button variant="secondary" onClick={state.openClassificationWorkspace}>
                Classification rules
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
