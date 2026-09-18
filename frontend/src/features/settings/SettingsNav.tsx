import { Icon } from '../../shared/ui/Icon';
import styles from './SettingsWorkspace.module.css';

export interface SettingsNavSection {
  id: string;
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
}

/**
 * The design's own `settingsNav()` section list (prototype/scripts/app.js) - Sources & connections,
 * Privacy & masking, Field mapping, Classification rules, Keyboard shortcuts. "Network proxy" is
 * deliberately not included, same reasoning as before this extraction (no such standalone feature exists
 * in this production app to route to).
 */
export const SETTINGS_NAV_SECTIONS: SettingsNavSection[] = [
  { id: 'sources', icon: 'database', label: 'Sources & connections' },
  { id: 'masking', icon: 'shield-check', label: 'Privacy & masking' },
  { id: 'mapping', icon: 'scan-search', label: 'Field mapping' },
  { id: 'classification', icon: 'tags', label: 'Classification rules' },
  { id: 'shortcuts', icon: 'keyboard', label: 'Keyboard shortcuts' },
];

export interface SettingsNavProps {
  activeId: string;
  onSelect: (id: string) => void;
}

/**
 * DRIFT-016 remediation - extracted from `SettingsWorkspace.tsx` (which rendered this list inline as
 * anchor links to its own same-page sections) so `ClassificationRulesWorkspace.tsx` can reuse the exact
 * same nav, not a parallel implementation, restoring the approved "Settings / Classification Rules
 * workspace context" for Classification Rules (including its New Rule/Extend Rule and Import sub-views,
 * which all render inside that one component). Buttons, not anchor links, since the caller decides what
 * "select this section" means: `SettingsWorkspace` scrolls to its own same-page section;
 * `ClassificationRulesWorkspace` navigates to a different top-level workspace entirely for Field
 * mapping/Sources/Privacy/Keyboard shortcuts, and simply stays put for its own "Classification rules" item.
 */
export function SettingsNav({ activeId, onSelect }: SettingsNavProps) {
  return (
    <nav className={styles.nav} aria-label="Settings sections">
      {SETTINGS_NAV_SECTIONS.map((section) => (
        <button
          key={section.id}
          type="button"
          className={styles.navItem}
          aria-current={section.id === activeId ? 'page' : undefined}
          onClick={() => onSelect(section.id)}
        >
          <Icon name={section.icon} size="sm" />
          {section.label}
        </button>
      ))}
    </nav>
  );
}
