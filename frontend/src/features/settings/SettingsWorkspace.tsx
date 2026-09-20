import { useEffect, useState } from 'react';
import { Button } from '../../shared/ui/Button';
import { WorkspaceBackButton } from '../../shared/ui/WorkspaceBackButton';
import { DockerSettingsPanel } from './DockerSettingsPanel';
import { OpenShiftSettingsPanel } from './OpenShiftSettingsPanel';
import { PrivacyMaskingSettingsPanel } from './PrivacyMaskingSettingsPanel';
import { KeyboardShortcutsInline } from '../../app/KeyboardShortcutsHelp';
import { SettingsNav } from './SettingsNav';
import type { SearchState, SettingsSectionId } from '../../app/useSearchState';
import type { OpenShiftScopeSummary } from '../../shared/api/types';
import type { ThemePreference } from '../../shared/theme/useTheme';
import styles from './SettingsWorkspace.module.css';

export interface SettingsWorkspaceProps {
  state: SearchState;
  /** SOURCE_EXPERIENCE_PARITY_DOCKER_OPENSHIFT - the same lifted scope summary Search reads, passed through so `OpenShiftSettingsPanel` can show it read-only. */
  openShiftScope: OpenShiftScopeSummary | null;
  onOpenShiftScopeChanged: () => void;
  onClose: () => void;
  /**
   * PR61_OWNER_NAVIGATION_RECOVERY_2 - which section to render as active/in view when this workspace mounts
   * (owner-observed defect: every caller previously landed on the default "Sources" section regardless of
   * where the user actually asked to go). Defaults are the caller's concern (`openSettingsWorkspace`'s own
   * default), not this component's.
   */
  targetSection: SettingsSectionId;
  /**
   * PR61_OWNER_MANUAL_USABILITY_AND_CLASSIFICATION_RECOVERY - dark theme itself was already implemented and
   * complete; the missing piece was any UI control to choose it (`useTheme`'s own `setPreference` was called
   * and discarded). `App.tsx` owns the one `useTheme()` instance for the whole app, passed through narrowly
   * (matching this component's existing `openShiftScope`/`onOpenShiftScopeChanged` convention) rather than
   * this workspace calling the hook a second time.
   */
  themePreference: ThemePreference;
  onThemePreferenceChanged: (preference: ThemePreference) => void;
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
export function SettingsWorkspace({
  state,
  openShiftScope,
  onOpenShiftScopeChanged,
  onClose,
  targetSection,
  themePreference,
  onThemePreferenceChanged,
}: SettingsWorkspaceProps) {
  // DRIFT-016 remediation - "active" section for the shared nav's own highlight, tracked from whichever
  // section last received a scroll-into-view. PR61_OWNER_NAVIGATION_RECOVERY_2 - now seeded from the caller's
  // own `targetSection` instead of always "sources", so arriving here from e.g. "Classification sidebar ->
  // Keyboard shortcuts" actually lands on Keyboard shortcuts. Every section is still always in the DOM and
  // reachable regardless of this value - it is a visual affordance, not a router.
  const [activeSectionId, setActiveSectionId] = useState<string>(targetSection);

  // This component remounts on every open (App.tsx's mutually-exclusive workspace ternary), so this effect
  // running once per mount is exactly "scroll to where the caller asked to land" - not a route-change effect
  // that would need to guard against re-firing while already open.
  useEffect(() => {
    document.getElementById(`settings-${targetSection}`)?.scrollIntoView({ block: 'start' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectSection(id: string) {
    setActiveSectionId(id);
    document.getElementById(`settings-${id}`)?.scrollIntoView({ block: 'start' });
  }

  return (
    <div className={styles.wrapper} data-testid="settings-workspace">
      <div className={styles.header}>
        {/* Settings is always entered directly (Shell's own header button) - its Back destination never varies. */}
        <WorkspaceBackButton destination="Search results" onClick={onClose} />
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
              <OpenShiftSettingsPanel scope={openShiftScope} onScopeChanged={onOpenShiftScopeChanged} />
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

          <AppearanceSection themePreference={themePreference} onThemePreferenceChanged={onThemePreferenceChanged} />

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
              <Button variant="secondary" onClick={() => state.openMappingWorkspace('settings')}>
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
              <Button variant="secondary" onClick={() => state.openClassificationWorkspace('settings')}>
                Manage classification rules
              </Button>
            </div>
          </section>

          <section id="settings-shortcuts" className={styles.section} aria-labelledby="settings-shortcuts-heading">
            <h2 id="settings-shortcuts-heading" className={styles.sectionHeading}>
              Keyboard shortcuts
            </h2>
            {/*
             * PR61_OWNER_NAVIGATION_RECOVERY_2 - owner-observed defect: this rendered the compact HEADER
             * popover trigger (a tiny keyboard-icon button that had to be clicked to reveal anything), not
             * real Settings content. `KeyboardShortcutsInline` shares the exact same registry-derived group
             * data as the header's own popover (`useShortcutGroups()`/`ShortcutGroupList` - see
             * `KeyboardShortcutsHelp.tsx`) and renders it directly, inline, with no trigger and no dialog.
             */}
            <KeyboardShortcutsInline />
          </section>
        </div>
      </div>
    </div>
  );
}

export interface AppearanceSectionProps {
  themePreference: ThemePreference;
  onThemePreferenceChanged: (preference: ThemePreference) => void;
}

const THEME_OPTIONS = [
  { value: 'system', label: 'Match system' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

/**
 * PR61_OWNER_MANUAL_USABILITY_AND_CLASSIFICATION_RECOVERY - the one real gap that usability review found:
 * dark theme itself was already implemented and complete, but nothing in the UI let a user actually choose it
 * (`useTheme`'s own `setPreference` was called and its result discarded). Extracted as its own small
 * component (not inlined in `SettingsWorkspace`) so it is directly unit-testable without the large
 * `SearchState` mock every other section here depends on.
 *
 * <p>PR61_OWNER_NAVIGATION_RECOVERY_2 - now also in {@link SETTINGS_NAV_SECTIONS} (`'appearance'`), reachable
 * directly from `ClassificationRulesWorkspace`'s/`FieldMappingWorkspace`'s own `SettingsNav` sidebar, landing
 * here deterministically via `openSettingsWorkspace('appearance')` - not the click-based same-page scroll
 * alone the section id still also supports for in-page navigation once already here.
 */
export function AppearanceSection({ themePreference, onThemePreferenceChanged }: AppearanceSectionProps) {
  return (
    <section id="settings-appearance" className={styles.section} aria-labelledby="settings-appearance-heading">
      <h2 id="settings-appearance-heading" className={styles.sectionHeading}>
        Appearance
      </h2>
      <p className={styles.sectionHint}>
        Choose how Log Explorer looks. "Match system" follows this device's own light/dark setting automatically,
        and stays in sync with it while this preference is selected.
      </p>
      <fieldset className={styles.sectionRow}>
        <legend className={styles.sectionLabel}>Theme</legend>
        <div className={styles.radioGroup}>
          {THEME_OPTIONS.map((option) => (
            <label key={option.value} className={styles.radioOption}>
              <input
                type="radio"
                name="theme-preference"
                value={option.value}
                checked={themePreference === option.value}
                onChange={() => onThemePreferenceChanged(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
    </section>
  );
}
