import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { JourneyEntryRow } from './JourneyEntryRow';
import { fullEvent, sparseEvent } from '../inspector/testEventFixture';

describe('JourneyEntryRow', () => {
  it('shows timestamp, service, level, business step, message, trace/span, and event/protocol metadata (HANDOVER.md §17)', () => {
    render(
      <ol>
        <JourneyEntryRow event={fullEvent()} />
      </ol>,
    );
    expect(screen.getByText('payments-api')).toBeInTheDocument();
    expect(screen.getByText('ERROR')).toBeInTheDocument();
    expect(screen.getByText('AUTHORIZE_PAYMENT')).toBeInTheDocument();
    expect(screen.getByText('Payment authorization failed')).toBeInTheDocument();
    expect(screen.getByText(/trace: trace-000100/i)).toBeInTheDocument();
    expect(screen.getByText(/span: span-000200/i)).toBeInTheDocument();
    expect(screen.getByText(/correlation: corr-000500/i)).toBeInTheDocument();
    expect(screen.getByText(/event: event-000400/i)).toBeInTheDocument();
  });

  it('a malformed event shows its raw line as the message, never fabricating one', () => {
    render(
      <ol>
        <JourneyEntryRow event={sparseEvent({ malformed: true, rawLine: '{not json' })} />
      </ol>,
    );
    expect(screen.getByText('{not json')).toBeInTheDocument();
  });

  it('a sparse event omits absent metadata rather than rendering empty labels', () => {
    render(
      <ol>
        <JourneyEntryRow event={sparseEvent()} />
      </ol>,
    );
    expect(screen.queryByText(/trace:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/span:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/correlation:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/event:/i)).not.toBeInTheDocument();
  });

  it('never renders a sensitive field anywhere in the entry', () => {
    render(
      <ol>
        <JourneyEntryRow event={fullEvent()} />
      </ol>,
    );
    const text = document.body.textContent?.toLowerCase() ?? '';
    for (const sensitive of ['cif', 'username', 'customerid', 'deviceid', 'deviceip']) {
      expect(text).not.toContain(sensitive);
    }
  });

  describe('free-text redaction display (Legacy Remediation Slice 7 - shared by Journey view and Live tail)', () => {
    it('renders an already-redacted message as plain text, never re-exposing anything', () => {
      render(
        <ol>
          <JourneyEntryRow event={fullEvent({ message: 'Login failed for customerId=[REDACTED] card [REDACTED_CARD] declined' })} />
        </ol>,
      );
      expect(screen.getByText(/customerId=\[REDACTED\]/)).toBeInTheDocument();
      expect(screen.getByText(/\[REDACTED_CARD\]/)).toBeInTheDocument();
    });

    it('an already-redacted malformed rawLine renders as the message too', () => {
      render(
        <ol>
          <JourneyEntryRow event={sparseEvent({ malformed: true, rawLine: 'NOT-JSON Authorization: Bearer [REDACTED]' })} />
        </ol>,
      );
      expect(screen.getByText(/Authorization: Bearer \[REDACTED\]/)).toBeInTheDocument();
    });
  });
});
