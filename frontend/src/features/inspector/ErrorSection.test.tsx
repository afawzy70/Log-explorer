import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { ErrorSection } from './ErrorSection';
import { copyToClipboard } from '../../shared/browser/clipboard';
import { fullEvent, sparseEvent } from './testEventFixture';

vi.mock('../../shared/browser/clipboard', () => ({ copyToClipboard: vi.fn() }));

const LONG_STACK_TRACE = [
  'java.lang.RuntimeException: payment gateway timeout',
  '\tat com.example.PaymentService.pay(PaymentService.java:42)',
  '\tat com.example.PaymentService.authorize(PaymentService.java:88)',
  '\tat com.example.CheckoutController.submit(CheckoutController.java:15)',
  'Caused by: java.net.SocketTimeoutException: Read timed out',
  '\tat java.base/sun.nio.ch.NioSocketImpl.timedRead(NioSocketImpl.java:283)',
].join('\n');

// LIVE_TIME_INSPECTOR_AND_DOCUMENTATION_RECOVERY - the dedicated, conditional Error tab. This
// component is only ever rendered by EventInspector.tsx when eventHasErrorInfo(event) is true - it does
// not re-decide that here, only how to present what's there.
describe('ErrorSection', () => {
  it('full exception and error code: renders both, plus the derived exception type, plus the full raw trace', () => {
    render(<ErrorSection event={fullEvent({ exception: LONG_STACK_TRACE })} />);
    expect(screen.getByText('Error code')).toBeInTheDocument();
    expect(screen.getByText('ERR_TIMEOUT')).toBeInTheDocument();
    expect(screen.getByText('Exception type')).toBeInTheDocument();
    expect(screen.getByText('java.lang.RuntimeException')).toBeInTheDocument();
    // The full multiline trace is preserved verbatim, real newlines intact, in one <pre> block.
    const pre = screen.getByText((_, el) => el?.tagName === 'PRE' && el.textContent === LONG_STACK_TRACE);
    expect(pre).toBeInTheDocument();
    expect(pre.tagName).toBe('PRE');
  });

  it('ERROR severity without any exception payload: a truthful empty state, never a fabricated trace', () => {
    render(<ErrorSection event={sparseEvent({ severity: 'ERROR', exception: null, errorCode: null })} />);
    expect(screen.getByText(/carries no exception or error code payload/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
  });

  // PR65_OWNER_REVIEW_DOCUMENTATION_AND_ERROR_EDGE_RECOVERY - whitespace-only exception/error code is
  // truthy but not real error information. ERROR severity alone still earns the tab (severity itself is
  // real error information), but it must show the same truthful empty state as no-payload-at-all: no
  // empty <pre>, no meaningless Copy button, no blank "Error code" field.
  it('ERROR severity with whitespace-only exception and error code: the same truthful empty state, no empty <pre>, no Copy button', () => {
    render(<ErrorSection event={sparseEvent({ severity: 'ERROR', exception: '   ', errorCode: '\t\n ' })} />);
    expect(screen.getByText(/carries no exception or error code payload/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
    expect(document.querySelector('pre')).not.toBeInTheDocument();
    expect(screen.queryByText('Error code')).not.toBeInTheDocument();
  });

  it('a non-blank exception with its own leading/trailing whitespace is rendered byte-for-byte, never trimmed', () => {
    const paddedException = '  java.lang.RuntimeException: padded\n\tat com.example.Foo.bar(Foo.java:1)  ';
    render(<ErrorSection event={sparseEvent({ severity: 'ERROR', exception: paddedException })} />);
    const pre = screen.getByText((_, el) => el?.tagName === 'PRE' && el.textContent === paddedException);
    expect(pre).toBeInTheDocument();
  });

  it('an exception present on a non-ERROR severity (e.g. WARN) still renders the exception content', () => {
    render(<ErrorSection event={sparseEvent({ severity: 'WARN', exception: 'java.lang.IllegalStateException: retrying' })} />);
    expect(screen.getByText('java.lang.IllegalStateException')).toBeInTheDocument();
    expect(screen.getByText(/retrying/)).toBeInTheDocument();
  });

  it('a long unbroken exception line (no newlines) still renders without throwing, inside the pre block', () => {
    const longLine = 'java.lang.RuntimeException: ' + 'x'.repeat(500);
    render(<ErrorSection event={sparseEvent({ severity: 'ERROR', exception: longLine })} />);
    const pre = screen.getByText((_, el) => el?.tagName === 'PRE' && el.textContent === longLine);
    expect(pre).toBeInTheDocument();
  });

  it('missing error code but present exception: only the exception fields show, no fabricated error code', () => {
    render(<ErrorSection event={sparseEvent({ severity: 'ERROR', errorCode: null, exception: 'java.lang.Exception: x' })} />);
    expect(screen.queryByText('Error code')).not.toBeInTheDocument();
    expect(screen.getByText('java.lang.Exception')).toBeInTheDocument();
  });

  it('Copy copies the exact already-redacted exception text, nothing more, nothing re-derived', async () => {
    const user = userEvent.setup();
    const exception = 'java.lang.RuntimeException: Authorization: Bearer [REDACTED]';
    render(<ErrorSection event={fullEvent({ exception })} />);
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(copyToClipboard).toHaveBeenCalledWith(exception);
  });

  it('never uses dangerouslySetInnerHTML - the exception renders as a real text node', () => {
    const { container } = render(<ErrorSection event={fullEvent({ exception: '<img src=x onerror=alert(1)>' })} />);
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('has no detectable accessibility violations, with a full trace or with the empty state', async () => {
    const { container, rerender } = render(<ErrorSection event={sparseEvent({ severity: 'ERROR' })} />);
    expect(await axe(container)).toHaveNoViolations();

    rerender(<ErrorSection event={fullEvent({ exception: LONG_STACK_TRACE })} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
