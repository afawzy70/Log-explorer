import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { ErrorSummarySection } from './ErrorSummarySection';
import { fullEvent, sparseEvent } from './testEventFixture';

// LIVE_TIME_INSPECTOR_AND_DOCUMENTATION_RECOVERY - Overview's "Error Summary". Renders nothing at all
// for a non-error event (same "absent means null" pattern as ClassificationSection).
describe('ErrorSummarySection', () => {
  it('renders nothing at all for a non-error event - no false or empty Error Summary', () => {
    const { container } = render(<ErrorSummarySection event={sparseEvent({ severity: 'INFO' })} onViewErrorDetails={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a fully sparse (null severity) event', () => {
    const { container } = render(<ErrorSummarySection event={sparseEvent()} onViewErrorDetails={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('full exception and error code: shows severity, error code, derived exception type, and a readable preview', () => {
    render(<ErrorSummarySection event={fullEvent()} onViewErrorDetails={vi.fn()} />);
    expect(screen.getByText('Error summary')).toBeInTheDocument();
    expect(screen.getByText('ERROR')).toBeInTheDocument();
    expect(screen.getByText('ERR_TIMEOUT')).toBeInTheDocument();
    expect(screen.getByText('java.lang.RuntimeException')).toBeInTheDocument();
    expect(screen.getByText('timeout')).toBeInTheDocument(); // the derived preview (first line, after the type)
  });

  it('ERROR severity without exception: shows severity, never an invented exception preview', () => {
    render(<ErrorSummarySection event={sparseEvent({ severity: 'ERROR' })} onViewErrorDetails={vi.fn()} />);
    expect(screen.getByText('ERROR')).toBeInTheDocument();
    expect(screen.queryByText('Exception type')).not.toBeInTheDocument();
  });

  // PR65_OWNER_REVIEW_DOCUMENTATION_AND_ERROR_EDGE_RECOVERY - whitespace-only exception/error code must
  // not produce a blank "Error code" field or a blank preview <pre>, even though the tab itself still
  // exists (ERROR severity alone is real error information).
  it('ERROR severity with whitespace-only exception and error code: no blank error code field, no blank preview', () => {
    render(<ErrorSummarySection event={sparseEvent({ severity: 'ERROR', exception: '  ', errorCode: '\t' })} onViewErrorDetails={vi.fn()} />);
    expect(screen.getByText('ERROR')).toBeInTheDocument();
    expect(screen.queryByText('Error code')).not.toBeInTheDocument();
    expect(screen.queryByText('Exception type')).not.toBeInTheDocument();
    expect(document.querySelector('pre')).not.toBeInTheDocument();
  });

  it('renders nothing for a non-error event with whitespace-only exception and error code', () => {
    const { container } = render(
      <ErrorSummarySection event={sparseEvent({ severity: 'INFO', exception: '   ', errorCode: ' ' })} onViewErrorDetails={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('"View full error details" switches to the Error tab via the supplied callback', async () => {
    const user = userEvent.setup();
    const onViewErrorDetails = vi.fn();
    render(<ErrorSummarySection event={fullEvent()} onViewErrorDetails={onViewErrorDetails} />);
    await user.click(screen.getByRole('button', { name: /view full error details/i }));
    expect(onViewErrorDetails).toHaveBeenCalledTimes(1);
  });

  it('never duplicates the full stack trace here - only a bounded preview, not the complete multiline trace', () => {
    const longTrace = 'java.lang.RuntimeException: boom\n' + Array.from({ length: 30 }, (_, i) => `\tat line${i}`).join('\n');
    render(<ErrorSummarySection event={fullEvent({ exception: longTrace })} onViewErrorDetails={vi.fn()} />);
    // The full 30-line trace is not rendered verbatim here (bounded preview only) - the "at line" frames
    // that make up the bulk of the trace never appear in this summary.
    expect(screen.queryByText(/at line29/)).not.toBeInTheDocument();
  });

  it('has no detectable accessibility violations for an error event', async () => {
    const { container } = render(<ErrorSummarySection event={fullEvent()} onViewErrorDetails={vi.fn()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
