import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { AppearanceSection } from './SettingsWorkspace';

/**
 * PR61_OWNER_MANUAL_USABILITY_AND_CLASSIFICATION_RECOVERY - dark theme itself is already implemented and
 * complete (see the mission's own factual-correction record); the gap this mission found and closed was that
 * no control in the UI let a user actually choose it. `AppearanceSection` is the fix: a plain, native,
 * keyboard-operable radio group wired to the app's one existing `useTheme()` instance.
 */
describe('AppearanceSection', () => {
  it('offers the three theme choices, none of them icon-only', () => {
    render(<AppearanceSection themePreference="system" onThemePreferenceChanged={vi.fn()} />);
    for (const label of ['Match system', 'Light', 'Dark']) {
      expect(screen.getByRole('radio', { name: label })).toBeInTheDocument();
    }
  });

  it('the current preference is reflected as the checked option, correctly named for assistive tech', () => {
    render(<AppearanceSection themePreference="dark" onThemePreferenceChanged={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Match system' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Light' })).not.toBeChecked();
  });

  it('choosing a different option calls back with exactly that preference', async () => {
    const user = userEvent.setup();
    const onThemePreferenceChanged = vi.fn();
    render(<AppearanceSection themePreference="system" onThemePreferenceChanged={onThemePreferenceChanged} />);
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(onThemePreferenceChanged).toHaveBeenCalledTimes(1);
    expect(onThemePreferenceChanged).toHaveBeenCalledWith('dark');
  });

  it('is fully keyboard-operable - Tab reaches the group, arrow keys move the selection, nothing else changes on focus alone', async () => {
    const user = userEvent.setup();
    const onThemePreferenceChanged = vi.fn();
    render(<AppearanceSection themePreference="light" onThemePreferenceChanged={onThemePreferenceChanged} />);
    await user.tab();
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveFocus();
    // Focusing a native radio never fires its own onChange - only an actual selection does.
    expect(onThemePreferenceChanged).not.toHaveBeenCalled();
    await user.keyboard('{ArrowDown}');
    expect(onThemePreferenceChanged).toHaveBeenCalledTimes(1);
    expect(onThemePreferenceChanged).toHaveBeenCalledWith('dark');
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(<AppearanceSection themePreference="system" onThemePreferenceChanged={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
