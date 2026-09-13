import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { ResultsTable } from './ResultsTable';
import type { LogEvent } from '../../shared/api/types';

/**
 * Performance checks at 100/1,000/configured-max events
 * (IMPLEMENTATION_PLAN.md "Phase G" "Browser checks (the gate)").
 * `configured-max` is the backend's `logexplorer.search.max-limit`
 * (5000, see backend/src/main/resources/application.yml).
 *
 * This is deliberately a Vitest/jsdom render-scale smoke test, not a
 * pixel-geometry test: `table-layout: fixed` geometry correctness (proven
 * for real in a browser at 1920/1440/1280/1024/768/390 and 125%/200% zoom
 * in `e2e/phase-g-results-table.spec.ts`) does not degrade with row
 * count - that is the defining property of fixed table layout, not
 * something that needs re-proving at every scale. What genuinely differs
 * at scale is whether the real component's own render logic blows up
 * (accidental O(n²) work, excessive re-renders) - that risk class is
 * exactly what this test guards against, using the real `ResultsTable`
 * component, not a hand-built HTML mimic.
 */
function syntheticEvent(index: number): LogEvent {
  return {
    timestamp: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(),
    timestampRaw: null,
    schemaVersion: '1',
    service: index % 2 === 0 ? 'gateway' : 'accounts-api',
    serviceSourceHint: null,
    severity: index % 5 === 0 ? 'ERROR' : 'INFO',
    severityNumber: null,
    message: `synthetic event number ${index} with a moderately long message to exercise real text layout`,
    logger: 'com.example.Synthetic',
    thread: 'main',
    exception: null,
    traceId: `trace-${index}`,
    spanId: null,
    journeyId: null,
    eventId: null,
    businessStep: null,
    uiIdentifier: null,
    errorCode: null,
    correlationId: null,
    protectedFields: { cif: null, userName: null, customerId: null, deviceId: null, deviceIp: null },
    devicePlatformType: null,
    language: null,
    serverIp: null,
    serverHost: null,
    unknownTopLevelFields: {},
    unknownMdcFields: {},
    malformed: false,
    rawLine: null,
    sourceId: 'fixture',
    composeProject: null,
    composeService: null,
    containerId: null,
    containerName: null,
    stream: null,
    namespace: null,
    pod: null,
    contextTargetProof: null,
  };
}

describe.each([100, 1000, 5000])('ResultsTable at %i events', (count) => {
  it(
    `renders exactly ${count} rows without throwing, in a bounded time`,
    () => {
      const events = Array.from({ length: count }, (_, i) => syntheticEvent(i));

      const start = performance.now();
      const { container } = render(<ResultsTable events={events} />);
      const elapsedMs = performance.now() - start;

      expect(container.querySelectorAll('tbody tr')).toHaveLength(count);
      // Deliberately generous - jsdom's own DOM construction is known to
      // be several times slower than a real browser's, so this is not a
      // real paint-performance budget. It exists only to catch an
      // accidental O(n^2)/runaway-work regression (e.g. an effect or
      // lookup that rescans the whole event list per row), which would
      // blow well past this ceiling even accounting for jsdom's overhead.
      expect(elapsedMs).toBeLessThan(15_000);
    },
    // vitest's own default 5000ms per-test timeout is separate from (and
    // shorter than) the 15s budget above - must be raised too, or the
    // 5000-event case is killed by the test runner before it can even
    // finish rendering, well before the real assertion ever gets a
    // chance to fail or pass on its own.
    20_000,
  );
});
