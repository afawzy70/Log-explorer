import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import { ClassificationSection } from './ClassificationSection';
import { fullEvent, sparseEvent } from './testEventFixture';
import type { LogEvent } from '../../shared/api/types';

function classifiedEvent(overrides: Partial<LogEvent> = {}): LogEvent {
  return fullEvent({
    tags: ['middleware', 'payments'],
    classifications: [
      {
        ruleId: 'mw-call',
        ruleName: 'Middleware call',
        tags: ['middleware'],
        extracted: [
          { name: 'endpoint', label: 'Endpoint', value: '/accounts', status: 'PRESENT', redacted: false, truncated: false },
          { name: 'durationMs', label: null, value: null, status: 'ABSENT', redacted: false, truncated: false },
        ],
      },
      {
        ruleId: 'pay-fail',
        ruleName: 'Payment failure',
        tags: ['payments'],
        extracted: [
          { name: 'account', label: 'Account', value: null, status: 'PRESENT', redacted: true, truncated: false },
          { name: 'amount', label: 'Amount', value: null, status: 'INVALID', redacted: false, truncated: false },
          { name: 'reason', label: 'Reason', value: '<b>Insufficient</b> funds', status: 'PRESENT', redacted: false, truncated: true },
        ],
      },
    ],
    ...overrides,
  });
}

function valueCellFor(label: string): HTMLElement {
  const dt = screen.getByText(label, { selector: 'dt' });
  return dt.nextElementSibling as HTMLElement;
}

describe('ClassificationSection', () => {
  it('renders nothing when the event has no classifications', () => {
    const { container } = render(<ClassificationSection event={sparseEvent()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows every tag as an uppercase text badge whose accessible text includes the tag, generically for two different tags', () => {
    render(<ClassificationSection event={classifiedEvent()} />);
    expect(screen.getByRole('heading', { name: 'Classification' })).toBeInTheDocument();
    const tagItems = within(screen.getByRole('list', { name: 'Tags' })).getAllByRole('listitem');
    expect(tagItems.map((li) => li.textContent)).toEqual(['Tag MIDDLEWARE', 'Tag PAYMENTS']);
    expect(screen.getByText('MIDDLEWARE')).toBeInTheDocument();
    expect(screen.getByText('PAYMENTS')).toBeInTheDocument();
  });

  it('shows each rule name as a subheading with its extracted fields in definition order', () => {
    render(<ClassificationSection event={classifiedEvent()} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Middleware call' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Payment failure' })).toBeInTheDocument();
    const labels = screen.getAllByRole('term').map((dt) => dt.textContent);
    expect(labels).toEqual(['Endpoint', 'durationMs', 'Account', 'Amount', 'Reason']);
    expect(valueCellFor('Endpoint')).toHaveTextContent('/accounts');
  });

  it('renders ABSENT/INVALID as "—" with an honest reason, and notes redacted/truncated values - never a fabricated value', () => {
    render(<ClassificationSection event={classifiedEvent()} />);
    const absent = valueCellFor('durationMs');
    expect(absent).toHaveTextContent('—');
    expect(absent).toHaveTextContent('Not found in this event');

    const invalid = valueCellFor('Amount');
    expect(invalid).toHaveTextContent('—');
    expect(invalid).toHaveTextContent('Could not be read');

    const redacted = valueCellFor('Account');
    expect(redacted).toHaveTextContent('—');
    expect(redacted).toHaveTextContent('Redacted');

    const truncated = valueCellFor('Reason');
    expect(truncated).toHaveTextContent('Truncated');
    // Log content renders as literal text, never markup.
    expect(truncated).toHaveTextContent('<b>Insufficient</b> funds');
    expect(truncated.querySelector('b')).toBeNull();
  });

  it('has no axe violations', async () => {
    const { container } = render(<ClassificationSection event={classifiedEvent()} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
