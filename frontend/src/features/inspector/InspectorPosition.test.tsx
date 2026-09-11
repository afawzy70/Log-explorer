import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { createRef } from 'react';
import { InspectorHeader } from './InspectorHeader';
import { fullEvent } from './testEventFixture';

/**
 * UX-R5 §5/§6/§7/§14 - the inspector header.
 *
 * The position indicator's copy is deliberately "Event N of M loaded",
 * not "Event N of M": the backend reports `total` as unknown for several
 * sources and "more available" is the normal case, so a bare "of M" would
 * read as a global position the app cannot actually know. These tests pin
 * the truthful wording, not just the numbers.
 */

function renderHeader(overrides: Partial<Parameters<typeof InspectorHeader>[0]> = {}) {
  const props = {
    event: fullEvent(),
    hasPrevious: true,
    hasNext: true,
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onClose: vi.fn(),
    closeButtonRef: createRef<HTMLButtonElement>(),
    position: { index: 4, total: 200 },
    onShowContext: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<InspectorHeader {...props} />) };
}

describe('UX-R5 §5 - inspector position indicator', () => {
  it('states the position within the LOADED set, in words that do not imply a global position', () => {
    renderHeader();
    expect(screen.getByText(/Event 4 of 200 loaded/i)).toBeInTheDocument();
  });

  it('is 1-based - the first event reads "Event 1", never "Event 0"', () => {
    renderHeader({ position: { index: 1, total: 200 } });
    expect(screen.getByText(/Event 1 of 200 loaded/i)).toBeInTheDocument();
  });

  it('reflects the last event of the loaded set', () => {
    renderHeader({ position: { index: 200, total: 200 } });
    expect(screen.getByText(/Event 200 of 200 loaded/i)).toBeInTheDocument();
  });

  it('is announced politely to assistive technology, since it changes on every Previous/Next', () => {
    renderHeader();
    expect(screen.getByText(/Event 4 of 200 loaded/i)).toHaveAttribute('aria-live', 'polite');
  });

  it('is omitted entirely rather than guessed when there is no position to report', () => {
    renderHeader({ position: null });
    expect(screen.queryByText(/of .* loaded/i)).not.toBeInTheDocument();
  });
});

describe('UX-R5 §6 - Previous/Next bounds', () => {
  it('disables Previous at the first event', () => {
    renderHeader({ hasPrevious: false, position: { index: 1, total: 200 } });
    expect(screen.getByRole('button', { name: 'Previous event' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next event' })).toBeEnabled();
  });

  it('disables Next at the last event', () => {
    renderHeader({ hasNext: false, position: { index: 200, total: 200 } });
    expect(screen.getByRole('button', { name: 'Next event' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous event' })).toBeEnabled();
  });

  it('navigates with the keyboard', async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    renderHeader({ onNext });

    screen.getByRole('button', { name: 'Next event' }).focus();
    await user.keyboard('{Enter}');

    expect(onNext).toHaveBeenCalled();
  });
});

describe('UX-R5 §14 - the inspector-level context action lives in the header', () => {
  it('offers "Show surrounding logs" from the header, independent of any section', () => {
    renderHeader();
    expect(screen.getByRole('button', { name: /show surrounding logs/i })).toBeInTheDocument();
  });

  it('uses the same wording as the row Actions menu, so one action is not named two ways', () => {
    renderHeader();
    // UX-R4 named this exact action "Show surrounding logs" on the results
    // row; the inspector must not call it "Show ±30 seconds".
    expect(screen.queryByRole('button', { name: /±30 seconds/i })).not.toBeInTheDocument();
  });

  it('confirms the bounded window before running, and only then invokes the action', async () => {
    const user = userEvent.setup();
    const onShowContext = vi.fn();
    renderHeader({ onShowContext });

    await user.click(screen.getByRole('button', { name: /show surrounding logs/i }));
    expect(onShowContext).not.toHaveBeenCalled(); // a confirm step, never instant

    const preview = screen.getByRole('dialog', { name: /confirm surrounding-context search/i });
    // The action must describe evidence, never causation (§15).
    expect(preview).toHaveTextContent(/not a cause/i);

    await user.click(screen.getByRole('button', { name: /^run$/i }));
    expect(onShowContext).toHaveBeenCalledTimes(1);
  });

  it('is omitted for an event with no timestamp - no window to centre on', () => {
    renderHeader({ event: { ...fullEvent(), timestamp: null } });
    expect(screen.queryByRole('button', { name: /show surrounding logs/i })).not.toBeInTheDocument();
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = renderHeader();
    expect(await axe(container)).toHaveNoViolations();
  });
});
