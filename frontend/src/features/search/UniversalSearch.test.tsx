import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { UniversalSearch, UNIVERSAL_SEARCH_LABEL } from './UniversalSearch';

describe('UniversalSearch', () => {
  it('has the exact required accessible label', () => {
    render(<UniversalSearch value="" onChange={vi.fn()} onSubmit={vi.fn()} onApplyDetectedField={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: UNIVERSAL_SEARCH_LABEL })).toBeInTheDocument();
  });

  it('typing calls onChange with the new value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<UniversalSearch value="" onChange={onChange} onSubmit={vi.fn()} onApplyDetectedField={vi.fn()} />);

    await user.type(screen.getByRole('textbox'), 'x');
    expect(onChange).toHaveBeenCalledWith('x');
  });

  it('Enter runs the search', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<UniversalSearch value="timeout" onChange={vi.fn()} onSubmit={onSubmit} onApplyDetectedField={vi.fn()} />);

    await user.click(screen.getByRole('textbox'));
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+Enter also runs the search', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<UniversalSearch value="timeout" onChange={vi.fn()} onSubmit={onSubmit} onApplyDetectedField={vi.fn()} />);

    await user.click(screen.getByRole('textbox'));
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('shows a confirmable suggestion for a detected ID, never silently reclassifying', async () => {
    render(
      <UniversalSearch
        value="trace-000100"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onApplyDetectedField={vi.fn()}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(/looks like a Trace ID/i);
    // The input's own value is unchanged - nothing was silently classified.
    expect(screen.getByRole('textbox')).toHaveValue('trace-000100');
  });

  it('confirming the suggestion applies the detected field and clears the free-text value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onApplyDetectedField = vi.fn();
    render(
      <UniversalSearch
        value="trace-000100"
        onChange={onChange}
        onSubmit={vi.fn()}
        onApplyDetectedField={onApplyDetectedField}
      />,
    );

    await user.click(screen.getByRole('button', { name: /search as trace id/i }));

    expect(onApplyDetectedField).toHaveBeenCalledWith('traceId', 'trace-000100');
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('dismissing the suggestion (X) hides it without clearing the typed text', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <UniversalSearch value="trace-000100" onChange={onChange} onSubmit={vi.fn()} onApplyDetectedField={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: /dismiss suggestion/i }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('trace-000100');
  });

  it('Escape closes the suggestion without clearing the typed text', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <UniversalSearch value="trace-000100" onChange={onChange} onSubmit={vi.fn()} onApplyDetectedField={vi.fn()} />,
    );

    await user.click(screen.getByRole('textbox'));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('trace-000100');
  });

  it('ordinary free text never shows a suggestion', () => {
    render(<UniversalSearch value="connection timeout" onChange={vi.fn()} onSubmit={vi.fn()} onApplyDetectedField={vi.fn()} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('has no detectable accessibility violations, with or without a suggestion showing', async () => {
    const { container, rerender } = render(
      <UniversalSearch value="" onChange={vi.fn()} onSubmit={vi.fn()} onApplyDetectedField={vi.fn()} />,
    );
    expect(await axe(container)).toHaveNoViolations();

    rerender(
      <UniversalSearch value="trace-000100" onChange={vi.fn()} onSubmit={vi.fn()} onApplyDetectedField={vi.fn()} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
