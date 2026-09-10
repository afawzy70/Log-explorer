import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useDismissableLayer } from './useDismissableLayer';

function Layer({
  label,
  isOpen,
  onDismiss,
  children,
}: {
  label: string;
  isOpen: boolean;
  onDismiss: () => void;
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useDismissableLayer(ref, isOpen, onDismiss);
  return isOpen ? (
    <div ref={ref} data-testid={label}>
      {children}
    </div>
  ) : null;
}

/**
 * Mirrors the real UX-R1 shape: Advanced Query's own trigger + popover
 * mounted *inside* the already-open More filters drawer - the "open inner"
 * trigger must itself be inside the outer layer's own container (just like
 * `QueryBuilder`'s trigger button is a child of `AdvancedFilters`' own
 * `wrapperRef`), otherwise clicking it would register as an outside click
 * on the outer layer and close it before the inner one ever opens.
 */
function NestedLayers({ outerOnDismiss, innerOnDismiss }: { outerOnDismiss: () => void; innerOnDismiss: () => void }) {
  const [outerOpen, setOuterOpen] = useState(true);
  const [innerOpen, setInnerOpen] = useState(false);
  return (
    <Layer
      label="outer"
      isOpen={outerOpen}
      onDismiss={() => {
        outerOnDismiss();
        setOuterOpen(false);
      }}
    >
      <button type="button" onClick={() => setInnerOpen(true)}>
        open inner
      </button>
      {innerOpen ? (
        <Layer
          label="inner"
          isOpen={innerOpen}
          onDismiss={() => {
            innerOnDismiss();
            setInnerOpen(false);
          }}
        />
      ) : null}
    </Layer>
  );
}

describe('useDismissableLayer', () => {
  it('a single open layer closes on Escape', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    function Single() {
      const ref = useRef<HTMLDivElement | null>(null);
      useDismissableLayer(ref, true, onDismiss);
      return <div ref={ref}>content</div>;
    }
    render(<Single />);
    await user.keyboard('{Escape}');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('a single open layer closes on outside click, not on an inside click', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    function Single() {
      const ref = useRef<HTMLDivElement | null>(null);
      useDismissableLayer(ref, true, onDismiss);
      return (
        <div>
          <div ref={ref}>
            <button type="button">inside</button>
          </div>
          <button type="button">outside</button>
        </div>
      );
    }
    render(<Single />);
    await user.click(screen.getByRole('button', { name: 'inside' }));
    expect(onDismiss).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'outside' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('with two nested open layers, Escape dismisses only the topmost (most-recently-opened) one - UX-R1 regression: Advanced Query nested inside More filters', async () => {
    const user = userEvent.setup();
    const outerOnDismiss = vi.fn();
    const innerOnDismiss = vi.fn();
    render(<NestedLayers outerOnDismiss={outerOnDismiss} innerOnDismiss={innerOnDismiss} />);

    await user.click(screen.getByRole('button', { name: 'open inner' }));
    expect(screen.getByTestId('outer')).toBeInTheDocument();
    expect(screen.getByTestId('inner')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(innerOnDismiss).toHaveBeenCalledTimes(1);
    expect(outerOnDismiss).not.toHaveBeenCalled();
    // The inner layer is gone; the outer one is still open.
    expect(screen.queryByTestId('inner')).not.toBeInTheDocument();
    expect(screen.getByTestId('outer')).toBeInTheDocument();
  });

  it('after the inner layer closes, a second Escape now dismisses the outer one', async () => {
    const user = userEvent.setup();
    const outerOnDismiss = vi.fn();
    const innerOnDismiss = vi.fn();
    render(<NestedLayers outerOnDismiss={outerOnDismiss} innerOnDismiss={innerOnDismiss} />);

    await user.click(screen.getByRole('button', { name: 'open inner' }));
    await user.keyboard('{Escape}');
    await user.keyboard('{Escape}');

    expect(outerOnDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('outer')).not.toBeInTheDocument();
  });
});
