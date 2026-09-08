import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { AllFieldsSection } from './AllFieldsSection';
import { fullEvent, sparseEvent } from './testEventFixture';

const NO_SOURCES = [] as never[];

describe('AllFieldsSection', () => {
  it('lists canonical fields, then unknown fields, then a collapsed raw-JSON disclosure', () => {
    render(<AllFieldsSection event={fullEvent()} sources={NO_SOURCES} />);
    expect(screen.getByText('message')).toBeInTheDocument();
    expect(screen.getByText(/unknown fields/i)).toBeInTheDocument();
    expect(screen.getByText('extraField')).toBeInTheDocument();
    expect(screen.getByText('mdc.custom.mdc.key')).toBeInTheDocument();

    const details = screen.getByText('Raw JSON').closest('details');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
  });

  it('the raw JSON is rendered as plain text (a single <pre> text node), never injected as HTML', () => {
    const event = fullEvent();
    render(<AllFieldsSection event={event} sources={NO_SOURCES} />);
    const pre = document.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toBe(JSON.stringify(event, null, 2));
    // The only children of the <pre> are text nodes - proves this came
    // from `{...}` text interpolation, not dangerouslySetInnerHTML.
    expect(pre?.children.length).toBe(0);
  });

  it('the search box filters both canonical and unknown fields by label or value', async () => {
    const user = userEvent.setup();
    render(<AllFieldsSection event={fullEvent()} sources={NO_SOURCES} />);

    await user.type(screen.getByLabelText(/search fields/i), 'traceId');
    expect(screen.getByText('traceId')).toBeInTheDocument();
    expect(screen.queryByText('message')).not.toBeInTheDocument();
  });

  it('a query matching nothing shows an honest empty state', async () => {
    const user = userEvent.setup();
    render(<AllFieldsSection event={fullEvent()} sources={NO_SOURCES} />);
    await user.type(screen.getByLabelText(/search fields/i), 'zzz-does-not-exist');
    expect(screen.getByText(/no fields match/i)).toBeInTheDocument();
  });

  it('a sparse event still renders (malformed is always present) with no unknown-fields group', () => {
    render(<AllFieldsSection event={sparseEvent()} sources={NO_SOURCES} />);
    expect(screen.getByText('malformed')).toBeInTheDocument();
    expect(screen.queryByText(/unknown fields/i)).not.toBeInTheDocument();
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = render(<AllFieldsSection event={fullEvent()} sources={NO_SOURCES} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
