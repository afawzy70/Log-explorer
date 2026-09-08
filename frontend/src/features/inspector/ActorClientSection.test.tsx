import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { ActorClientSection } from './ActorClientSection';
import { fullEvent, sparseEvent } from './testEventFixture';

describe('ActorClientSection', () => {
  it('shows every masked value, labelled protected/masked, with no reveal action', () => {
    const event = fullEvent();
    render(<ActorClientSection event={event} />);

    expect(screen.getByText(/protected \/ masked/i)).toBeInTheDocument();
    expect(screen.getByText(event.protectedFields.userName!)).toBeInTheDocument();
    expect(screen.getByText(event.protectedFields.cif!)).toBeInTheDocument();
    // No reveal action anywhere in this section (CLAUDE.md §2 rule 5).
    expect(screen.queryByRole('button', { name: /reveal|show raw|unmask/i })).not.toBeInTheDocument();
  });

  it('an event with no actor/client data shows an honest empty note, not an empty section', () => {
    render(<ActorClientSection event={sparseEvent()} />);
    expect(screen.getByText(/no actor or client data/i)).toBeInTheDocument();
    expect(screen.queryByText(/protected \/ masked/i)).not.toBeInTheDocument();
  });

  it('has no detectable accessibility violations, with or without data', async () => {
    const { container, rerender } = render(<ActorClientSection event={sparseEvent()} />);
    expect(await axe(container)).toHaveNoViolations();

    rerender(<ActorClientSection event={fullEvent()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
