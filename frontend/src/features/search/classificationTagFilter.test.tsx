import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { ActiveFilters } from './ActiveFilters';
import type { ActiveFiltersProps } from './ActiveFilters';
import { AdvancedFilters } from './AdvancedFilters';
import type { AdvancedFiltersProps } from './AdvancedFilters';
import { emptyAdvancedFilterValues } from './advancedFilterFields';
import { emptyQueryAuthoringState } from './QueryBuilder';
import { DEFAULT_SEVERITY_LEVELS } from './severityLevels';

function activeProps(overrides: Partial<ActiveFiltersProps> = {}): ActiveFiltersProps {
  return {
    timeRangeLabel: 'Last 1 day',
    onRemoveTimeRange: vi.fn(),
    selectedLevels: DEFAULT_SEVERITY_LEVELS,
    onRemoveSeverity: vi.fn(),
    selectedServices: [],
    onRemoveService: vi.fn(),
    advancedValues: emptyAdvancedFilterValues(),
    onRemoveAdvancedField: vi.fn(),
    onClearAll: vi.fn(),
    ...overrides,
  };
}

function drawerProps(overrides: Partial<AdvancedFiltersProps> = {}): AdvancedFiltersProps {
  return {
    values: emptyAdvancedFilterValues(),
    onApply: vi.fn(),
    queryState: emptyQueryAuthoringState(),
    onApplyQuery: vi.fn(),
    rawLogQlSupported: false,
    availableTags: ['middleware', 'payments'],
    availableTagsError: null,
    selectedTags: [],
    onApplyTags: vi.fn(),
    onOpen: vi.fn(),
    ...overrides,
  };
}

describe('Classification tag filter', () => {
  describe('ActiveFilters chips', () => {
    it('shows one removable "Tag:" chip per selected tag, and removing one reports that tag', async () => {
      const user = userEvent.setup();
      const onRemoveTag = vi.fn();
      render(<ActiveFilters {...activeProps({ selectedTags: ['middleware', 'payments'], onRemoveTag })} />);
      expect(screen.getAllByText('Tag:')).toHaveLength(2);
      expect(screen.getByText('middleware')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Remove tag filter payments' }));
      expect(onRemoveTag).toHaveBeenCalledWith('payments');
    });

    it('shows no tag chips when no tag is selected', () => {
      render(<ActiveFilters {...activeProps()} />);
      expect(screen.queryByText('Tag:')).not.toBeInTheDocument();
    });
  });

  describe('More filters drawer', () => {
    it('loads tags on open, applies checked tags only on Apply, with the server-side helper text', async () => {
      const user = userEvent.setup();
      const props = drawerProps();
      render(<AdvancedFilters {...props} />);

      await user.click(screen.getByRole('button', { name: /^more filters$/i }));
      expect(props.onOpen).toHaveBeenCalledTimes(1);
      const group = screen.getByRole('group', { name: 'Classification tags' });
      expect(
        within(group).getByText(
          'Matches events with any selected tag. Tags are applied by the server to the events each search retrieves.',
        ),
      ).toBeInTheDocument();

      await user.click(within(group).getByRole('checkbox', { name: 'middleware' }));
      expect(props.onApplyTags).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'Apply' }));
      expect(props.onApplyTags).toHaveBeenCalledWith(['middleware']);
    });

    it('Cancel discards the tag draft', async () => {
      const user = userEvent.setup();
      const props = drawerProps({ selectedTags: ['payments'] });
      render(<AdvancedFilters {...props} />);
      await user.click(screen.getByRole('button', { name: /more filters/i }));
      const group = screen.getByRole('group', { name: 'Classification tags' });
      expect(within(group).getByRole('checkbox', { name: 'payments' })).toBeChecked();
      await user.click(within(group).getByRole('checkbox', { name: 'middleware' }));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(props.onApplyTags).not.toHaveBeenCalled();
    });

    it('says "No classification tags yet." when no rules define tags', async () => {
      const user = userEvent.setup();
      render(<AdvancedFilters {...drawerProps({ availableTags: [] })} />);
      await user.click(screen.getByRole('button', { name: /^more filters$/i }));
      expect(screen.getByText('No classification tags yet.')).toBeInTheDocument();
    });

    it('counts selected tags in the active badge and has no axe violations when open', async () => {
      const user = userEvent.setup();
      const { container } = render(<AdvancedFilters {...drawerProps({ selectedTags: ['middleware'] })} />);
      expect(screen.getByRole('button', { name: /more filters.*1.*active/i })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /more filters/i }));
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
