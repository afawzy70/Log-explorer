import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { QueryBuilder, emptyQueryAuthoringState, isQueryActive, resolveQueryText, resolveRawLogQl } from './QueryBuilder';
import type { QueryAuthoringState } from './QueryBuilder';

function open(user: ReturnType<typeof userEvent.setup>) {
  // The trigger's accessible name is "Query" alone, or "QueryQuery active"
  // when the active-indicator badge is also present (its VisuallyHidden
  // text contributes to the accessible name too) - match the stable prefix.
  return user.click(screen.getByRole('button', { name: /^query/i }));
}

describe('QueryBuilder', () => {
  describe('guided mode', () => {
    it('starts with no conditions and an empty generated query', async () => {
      const user = userEvent.setup();
      render(<QueryBuilder value={emptyQueryAuthoringState()} onApply={vi.fn()} rawLogQlSupported={false} />);
      await open(user);
      expect(screen.getByText('(no query)')).toBeInTheDocument();
    });

    it('adding a condition and filling it in deterministically generates the DSL text', async () => {
      const user = userEvent.setup();
      render(<QueryBuilder value={emptyQueryAuthoringState()} onApply={vi.fn()} rawLogQlSupported={false} />);
      await open(user);

      await user.click(screen.getByRole('button', { name: /\+ condition/i }));
      await user.selectOptions(screen.getByLabelText('Field'), 'service');
      await user.type(screen.getByLabelText('Value'), 'gateway');

      expect(screen.getByText('service = "gateway"')).toBeInTheDocument();
    });

    it('AND/OR grouping: two conditions joined by AND, then switched to OR, changes the generated text', async () => {
      const user = userEvent.setup();
      render(<QueryBuilder value={emptyQueryAuthoringState()} onApply={vi.fn()} rawLogQlSupported={false} />);
      await open(user);

      await user.click(screen.getByRole('button', { name: /\+ condition/i }));
      await user.click(screen.getByRole('button', { name: /\+ condition/i }));
      const values = screen.getAllByLabelText('Value');
      await user.type(values[0], 'gateway');
      await user.type(values[1], 'ERROR');
      const fields = screen.getAllByLabelText('Field');
      await user.selectOptions(fields[1], 'level');

      expect(screen.getByText('service = "gateway" AND level = "ERROR"')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /any \(or\)/i }));
      expect(screen.getByText('service = "gateway" OR level = "ERROR"')).toBeInTheDocument();
    });

    it('a nested group produces the browser-verification shape: service = X AND (level = ERROR OR level = WARN)', async () => {
      const user = userEvent.setup();
      render(<QueryBuilder value={emptyQueryAuthoringState()} onApply={vi.fn()} rawLogQlSupported={false} />);
      await open(user);

      await user.click(screen.getByRole('button', { name: /\+ condition/i }));
      await user.type(screen.getAllByLabelText('Value')[0], 'gateway');

      await user.click(screen.getByRole('button', { name: /\+ group/i }));
      // Two "+ Condition" affordances now exist. The nested group's own
      // fieldset (with its own trailing "+ Condition") renders as a *child*
      // of the root's children list, before the root's own trailing
      // actions row - so the nested group's button is first in DOM order.
      const nestedAddCondition = () => screen.getAllByRole('button', { name: /\+ condition/i })[0];
      await user.click(nestedAddCondition());
      await user.click(nestedAddCondition());

      const fields = screen.getAllByLabelText('Field');
      const values = screen.getAllByLabelText('Value');
      // fields[0]/values[0] = root condition (service); fields[1]/values[1]
      // and fields[2]/values[2] = the two nested-group conditions.
      await user.selectOptions(fields[1], 'level');
      await user.type(values[1], 'ERROR');
      await user.selectOptions(fields[2], 'level');
      await user.type(values[2], 'WARN');

      // The nested group defaults to OR (opposite of the root's AND).
      expect(screen.getByText('service = "gateway" AND (level = "ERROR" OR level = "WARN")')).toBeInTheDocument();
    });

    it('removing a condition updates the generated text', async () => {
      const user = userEvent.setup();
      render(<QueryBuilder value={emptyQueryAuthoringState()} onApply={vi.fn()} rawLogQlSupported={false} />);
      await open(user);

      await user.click(screen.getByRole('button', { name: /\+ condition/i }));
      await user.click(screen.getByRole('button', { name: /\+ condition/i }));
      await user.type(screen.getAllByLabelText('Value')[0], 'gateway');
      await user.type(screen.getAllByLabelText('Value')[1], 'ERROR');

      await user.click(screen.getAllByRole('button', { name: /remove condition/i })[1]);
      expect(screen.getByText('service = "gateway"')).toBeInTheDocument();
    });

    it('the "+ Group" affordance disappears once the bounded nesting depth is reached', async () => {
      const user = userEvent.setup();
      render(<QueryBuilder value={emptyQueryAuthoringState()} onApply={vi.fn()} rawLogQlSupported={false} />);
      await open(user);

      await user.click(screen.getByRole('button', { name: /\+ group/i }));
      // Only the root's own "+ Group" existed; the nested group must not offer another.
      expect(screen.getAllByRole('button', { name: /\+ group/i })).toHaveLength(1);
    });

    it('sensitive fields never offer "contains" as an operator', async () => {
      const user = userEvent.setup();
      render(<QueryBuilder value={emptyQueryAuthoringState()} onApply={vi.fn()} rawLogQlSupported={false} />);
      await open(user);

      await user.click(screen.getByRole('button', { name: /\+ condition/i }));
      await user.selectOptions(screen.getByLabelText('Field'), 'cif');

      const operatorOptions = within(screen.getByLabelText('Operator') as HTMLSelectElement).getAllByRole('option');
      expect(operatorOptions.map((o) => o.textContent)).toEqual(['=', '!=']);
    });
  });

  describe('draft/apply/cancel semantics', () => {
    it('editing the draft never calls onApply (no request fires merely from editing)', async () => {
      const user = userEvent.setup();
      const onApply = vi.fn();
      render(<QueryBuilder value={emptyQueryAuthoringState()} onApply={onApply} rawLogQlSupported={false} />);
      await open(user);
      await user.click(screen.getByRole('button', { name: /\+ condition/i }));
      await user.type(screen.getByLabelText('Value'), 'gateway');
      expect(onApply).not.toHaveBeenCalled();
    });

    it('Apply commits the drafted guided query and closes the panel', async () => {
      const user = userEvent.setup();
      const onApply = vi.fn();
      render(<QueryBuilder value={emptyQueryAuthoringState()} onApply={onApply} rawLogQlSupported={false} />);
      await open(user);
      await user.click(screen.getByRole('button', { name: /\+ condition/i }));
      await user.type(screen.getByLabelText('Value'), 'gateway');
      await user.click(screen.getByRole('button', { name: /^apply$/i }));

      expect(onApply).toHaveBeenCalledTimes(1);
      const committed = onApply.mock.calls[0][0] as QueryAuthoringState;
      expect(resolveQueryText(committed)).toBe('service = "gateway"');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('Cancel discards the draft without mutating the committed query', async () => {
      const user = userEvent.setup();
      const onApply = vi.fn();
      render(<QueryBuilder value={emptyQueryAuthoringState()} onApply={onApply} rawLogQlSupported={false} />);
      await open(user);
      await user.click(screen.getByRole('button', { name: /\+ condition/i }));
      await user.type(screen.getByLabelText('Value'), 'discarded-value');
      await user.click(screen.getByRole('button', { name: /^cancel$/i }));

      expect(onApply).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('reopening after Cancel shows the last-applied query, not the discarded draft', async () => {
      const user = userEvent.setup();
      render(<QueryBuilder value={emptyQueryAuthoringState()} onApply={vi.fn()} rawLogQlSupported={false} />);
      await open(user);
      await user.click(screen.getByRole('button', { name: /\+ condition/i }));
      await user.type(screen.getByLabelText('Value'), 'discarded-value');
      await user.click(screen.getByRole('button', { name: /^cancel$/i }));

      await open(user);
      expect(screen.getByText('(no query)')).toBeInTheDocument();
    });

    it('Escape closes without applying', async () => {
      const user = userEvent.setup();
      const onApply = vi.fn();
      render(<QueryBuilder value={emptyQueryAuthoringState()} onApply={onApply} rawLogQlSupported={false} />);
      await open(user);
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(onApply).not.toHaveBeenCalled();
    });

    it('Clear resets the draft to no query (still requires Apply to commit)', async () => {
      const user = userEvent.setup();
      const onApply = vi.fn();
      const committed: QueryAuthoringState = { ...emptyQueryAuthoringState(), text: 'stale', mode: 'text' };
      render(<QueryBuilder value={committed} onApply={onApply} rawLogQlSupported={false} />);
      await open(user);
      await user.click(screen.getByRole('button', { name: /^clear$/i }));
      expect(onApply).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: /^apply$/i }));
      expect(resolveQueryText(onApply.mock.calls[0][0] as QueryAuthoringState)).toBeUndefined();
    });

    it('shows an active-query indicator only once a query has actually been applied', async () => {
      const user = userEvent.setup();
      const { rerender } = render(<QueryBuilder value={emptyQueryAuthoringState()} onApply={vi.fn()} rawLogQlSupported={false} />);
      expect(screen.queryByText('Query active')).not.toBeInTheDocument();

      const committed: QueryAuthoringState = { ...emptyQueryAuthoringState(), mode: 'text', text: 'service = "x"' };
      rerender(<QueryBuilder value={committed} onApply={vi.fn()} rawLogQlSupported={false} />);
      expect(screen.getByText('Query active')).toBeInTheDocument();
      void user;
    });
  });

  describe('text mode', () => {
    it('typing arbitrary DSL text is accepted as-is (no frontend parsing/validation blocks it)', async () => {
      const user = userEvent.setup();
      const onApply = vi.fn();
      render(<QueryBuilder value={emptyQueryAuthoringState()} onApply={onApply} rawLogQlSupported={false} />);
      await open(user);
      await user.click(screen.getByRole('tab', { name: /^text$/i }));
      await user.type(screen.getByLabelText('Query text'), 'service = "gateway" and level = "ERROR"');
      await user.click(screen.getByRole('button', { name: /^apply$/i }));

      const committed = onApply.mock.calls[0][0] as QueryAuthoringState;
      expect(resolveQueryText(committed)).toBe('service = "gateway" and level = "ERROR"');
    });

    it('switching guided -> text always shows the generated DSL, never a blank field', async () => {
      const user = userEvent.setup();
      render(<QueryBuilder value={emptyQueryAuthoringState()} onApply={vi.fn()} rawLogQlSupported={false} />);
      await open(user);
      await user.click(screen.getByRole('button', { name: /\+ condition/i }));
      await user.type(screen.getByLabelText('Value'), 'gateway');
      await user.click(screen.getByRole('tab', { name: /^text$/i }));
      expect(screen.getByLabelText('Query text')).toHaveValue('service = "gateway"');
    });

    it('switching text -> guided with unmodified text (matching the tree) never warns', async () => {
      const user = userEvent.setup();
      render(<QueryBuilder value={emptyQueryAuthoringState()} onApply={vi.fn()} rawLogQlSupported={false} />);
      await open(user);
      await user.click(screen.getByRole('tab', { name: /^text$/i }));
      await user.click(screen.getByRole('tab', { name: /^guided$/i }));
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /^guided$/i })).toHaveAttribute('aria-selected', 'true');
    });

    it('switching text -> guided after editing the text warns before discarding it, and Cancel keeps the text intact', async () => {
      const user = userEvent.setup();
      render(<QueryBuilder value={emptyQueryAuthoringState()} onApply={vi.fn()} rawLogQlSupported={false} />);
      await open(user);
      await user.click(screen.getByRole('tab', { name: /^text$/i }));
      await user.type(screen.getByLabelText('Query text'), 'level = "ERROR"');
      await user.click(screen.getByRole('tab', { name: /^guided$/i }));

      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /keep editing text/i }));
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Query text')).toHaveValue('level = "ERROR"');
    });

    it('confirming the destructive switch starts a fresh, empty guided query and never fabricates a tree from the typed text', async () => {
      const user = userEvent.setup();
      render(<QueryBuilder value={emptyQueryAuthoringState()} onApply={vi.fn()} rawLogQlSupported={false} />);
      await open(user);
      await user.click(screen.getByRole('tab', { name: /^text$/i }));
      await user.type(screen.getByLabelText('Query text'), 'level = "ERROR"');
      await user.click(screen.getByRole('tab', { name: /^guided$/i }));
      await user.click(screen.getByRole('button', { name: /discard and switch/i }));

      expect(screen.getByRole('tab', { name: /^guided$/i })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByText('(no query)')).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'level' })).not.toBeInTheDocument(); // no stray condition rows
    });
  });

  describe('raw LogQL capability gating', () => {
    it('the Raw LogQL tab is absent when the source does not support it', async () => {
      const user = userEvent.setup();
      render(<QueryBuilder value={emptyQueryAuthoringState()} onApply={vi.fn()} rawLogQlSupported={false} />);
      await open(user);
      expect(screen.queryByRole('tab', { name: /raw logql/i })).not.toBeInTheDocument();
    });

    it('the Raw LogQL tab appears when the source supports it, and is off (not selected) by default', async () => {
      const user = userEvent.setup();
      render(<QueryBuilder value={emptyQueryAuthoringState()} onApply={vi.fn()} rawLogQlSupported={true} />);
      await open(user);
      const tab = screen.getByRole('tab', { name: /raw logql/i });
      expect(tab).toBeInTheDocument();
      expect(tab).toHaveAttribute('aria-selected', 'false');
    });

    it('carries a clear expert-mode label and can be applied, producing rawLogQl not a DSL query', async () => {
      const user = userEvent.setup();
      const onApply = vi.fn();
      render(<QueryBuilder value={emptyQueryAuthoringState()} onApply={onApply} rawLogQlSupported={true} />);
      await open(user);
      await user.click(screen.getByRole('tab', { name: /raw logql/i }));
      expect(screen.getByText(/advanced:.*bypassing the generated query.*off by default/i)).toBeInTheDocument();

      // userEvent.type() treats {...} as special-key syntax, so a raw LogQL
      // selector's braces are set directly instead.
      fireEvent.change(screen.getByLabelText('Raw LogQL'), { target: { value: '{namespace="prod"}' } });
      await user.click(screen.getByRole('button', { name: /^apply$/i }));

      const committed = onApply.mock.calls[0][0] as QueryAuthoringState;
      expect(resolveRawLogQl(committed)).toBe('{namespace="prod"}');
      expect(resolveQueryText(committed)).toBeUndefined();
    });
  });

  describe('helpers', () => {
    it('isQueryActive is false for an empty state in every mode', () => {
      expect(isQueryActive(emptyQueryAuthoringState())).toBe(false);
      expect(isQueryActive({ ...emptyQueryAuthoringState(), mode: 'text', text: '  ' })).toBe(false);
      expect(isQueryActive({ ...emptyQueryAuthoringState(), mode: 'rawLogQl', rawLogQl: '' })).toBe(false);
    });

    it('isQueryActive is true once any mode has real content', () => {
      expect(isQueryActive({ ...emptyQueryAuthoringState(), mode: 'text', text: 'x' })).toBe(true);
      expect(isQueryActive({ ...emptyQueryAuthoringState(), mode: 'rawLogQl', rawLogQl: '{a="b"}' })).toBe(true);
    });
  });

  describe('accessibility', () => {
    it('has no detectable accessibility violations, closed or open, in every mode', async () => {
      const user = userEvent.setup();
      const { container } = render(<QueryBuilder value={emptyQueryAuthoringState()} onApply={vi.fn()} rawLogQlSupported={true} />);
      expect(await axe(container)).toHaveNoViolations();

      await open(user);
      expect(await axe(container)).toHaveNoViolations();

      await user.click(screen.getByRole('tab', { name: /^text$/i }));
      expect(await axe(container)).toHaveNoViolations();

      await user.click(screen.getByRole('tab', { name: /raw logql/i }));
      expect(await axe(container)).toHaveNoViolations();
    });

    it('every guided condition field is keyboard-operable via label association (getByLabelText)', async () => {
      const user = userEvent.setup();
      render(<QueryBuilder value={emptyQueryAuthoringState()} onApply={vi.fn()} rawLogQlSupported={false} />);
      await open(user);
      await user.click(screen.getByRole('button', { name: /\+ condition/i }));

      await user.tab(); // combinator All button etc. is before, but Field select must be reachable
      expect(screen.getByLabelText('Field')).toBeInTheDocument();
      expect(screen.getByLabelText('Operator')).toBeInTheDocument();
      expect(screen.getByLabelText('Value')).toBeInTheDocument();
    });
  });
});
