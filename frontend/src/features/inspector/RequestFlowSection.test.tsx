import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { RequestFlowSection } from './RequestFlowSection';
import { fullEvent, sparseEvent } from './testEventFixture';
import { copyToClipboard } from '../../shared/browser/clipboard';

vi.mock('../../shared/browser/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(undefined),
}));

describe('RequestFlowSection', () => {
  it('an event with no request-flow IDs shows an honest empty note, not a blank section', () => {
    render(<RequestFlowSection event={sparseEvent()} onFindRelated={vi.fn()} onShowContext={vi.fn()} />);
    expect(screen.getByText(/no journey, correlation, trace, span, or event id/i)).toBeInTheDocument();
  });

  it('a full event lists every identifier with a Copy and a Find related logs action each', () => {
    render(<RequestFlowSection event={fullEvent()} onFindRelated={vi.fn()} onShowContext={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: /^copy$/i })).toHaveLength(5);
    expect(screen.getAllByRole('button', { name: /find related logs/i })).toHaveLength(5);
  });

  it('never renders a copy/find-related action for a sensitive field - only journey/correlation/trace/span/event appear', () => {
    render(<RequestFlowSection event={fullEvent()} onFindRelated={vi.fn()} onShowContext={vi.fn()} />);
    const text = document.body.textContent?.toLowerCase() ?? '';
    // The section's own labels are exactly the five non-sensitive IDs;
    // none of the five sensitive field names (CLAUDE.md §2 rule 1) appear.
    for (const sensitive of ['cif', 'username', 'customerid', 'deviceid', 'deviceip']) {
      expect(text).not.toContain(sensitive);
    }
  });

  it('Copy writes the real, non-sensitive identifier value to the clipboard', async () => {
    const user = userEvent.setup();
    render(<RequestFlowSection event={fullEvent()} onFindRelated={vi.fn()} onShowContext={vi.fn()} />);
    await user.click(screen.getAllByRole('button', { name: /^copy$/i })[0]);
    expect(copyToClipboard).toHaveBeenCalledWith('journey-000300');
  });

  it('Find related logs calls onFindRelated with the exact field and value', async () => {
    const user = userEvent.setup();
    const onFindRelated = vi.fn();
    render(<RequestFlowSection event={fullEvent()} onFindRelated={onFindRelated} onShowContext={vi.fn()} />);
    await user.click(screen.getAllByRole('button', { name: /find related logs/i })[0]);
    expect(onFindRelated).toHaveBeenCalledWith('journeyId', 'journey-000300');
  });

  it('has no detectable accessibility violations, with or without identifiers', async () => {
    const { container, rerender } = render(
      <RequestFlowSection event={sparseEvent()} onFindRelated={vi.fn()} onShowContext={vi.fn()} />,
    );
    expect(await axe(container)).toHaveNoViolations();

    rerender(<RequestFlowSection event={fullEvent()} onFindRelated={vi.fn()} onShowContext={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
