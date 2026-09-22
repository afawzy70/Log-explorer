import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'jest-axe';
import { BusinessSection } from './BusinessSection';
import { fullEvent, sparseEvent } from './testEventFixture';

// LIVE_TIME_INSPECTOR_AND_DOCUMENTATION_RECOVERY - BusinessSection replaces the former
// BusinessErrorSection, split so error/exception data can never mix into the business tab.
describe('BusinessSection', () => {
  it('shows business step and UI identifier - never error code or exception, even when both exist on the event', () => {
    const event = fullEvent(); // fullEvent() carries errorCode + exception too - must not leak in here
    render(<BusinessSection event={event} />);

    expect(screen.getByText('Business step')).toBeInTheDocument();
    expect(screen.getByText(event.businessStep!)).toBeInTheDocument();
    expect(screen.getByText('UI identifier')).toBeInTheDocument();
    expect(screen.getByText(event.uiIdentifier!)).toBeInTheDocument();

    expect(screen.queryByText('Error code')).not.toBeInTheDocument();
    expect(screen.queryByText(event.errorCode!)).not.toBeInTheDocument();
    expect(screen.queryByText(/exception/i)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Business' }).textContent).toBe('Business');
  });

  it('business data only (no error data at all) renders cleanly', () => {
    const event = sparseEvent({ businessStep: 'AUTHORIZE_PAYMENT', uiIdentifier: 'checkout-submit' });
    render(<BusinessSection event={event} />);
    expect(screen.getByText('AUTHORIZE_PAYMENT')).toBeInTheDocument();
    expect(screen.getByText('checkout-submit')).toBeInTheDocument();
  });

  it('neither business nor error data: an honest empty state, never mentioning error/exception', () => {
    render(<BusinessSection event={sparseEvent()} />);
    expect(screen.getByText(/no business step or ui identifier on this event/i)).toBeInTheDocument();
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/exception/i)).not.toBeInTheDocument();
  });

  it('missing/null business fields individually are simply omitted, never a fabricated placeholder', () => {
    render(<BusinessSection event={sparseEvent({ businessStep: 'ONLY_STEP', uiIdentifier: null })} />);
    expect(screen.getByText('ONLY_STEP')).toBeInTheDocument();
    expect(screen.queryByText('UI identifier')).not.toBeInTheDocument();
  });

  it('has no detectable accessibility violations, with or without data', async () => {
    const { container, rerender } = render(<BusinessSection event={sparseEvent()} />);
    expect(await axe(container)).toHaveNoViolations();

    rerender(<BusinessSection event={fullEvent()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
