import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  ALL_COLUMN_IDS,
  COLUMN_REGISTRY,
  COLUMN_REGISTRY_BY_ID,
  DEFAULT_COLUMN_ORDER,
  DEFAULT_HIDDEN_COLUMN_IDS,
} from './columnRegistry';
import { fullEvent, sparseEvent } from '../inspector/testEventFixture';

const SENSITIVE_FIELDS = ['cif', 'userName', 'customerId', 'deviceId', 'deviceIp'];

describe('columnRegistry', () => {
  it('has exactly seven default-visible columns, in the required order, with the required labels', () => {
    const defaults = COLUMN_REGISTRY.filter((c) => c.defaultVisible);
    expect(defaults.map((c) => c.id)).toEqual(['time', 'level', 'service', 'whatHappened', 'userCustomer', 'correlationTrace']);
    expect(defaults.map((c) => c.label)).toEqual([
      'Time',
      'Level',
      'Service',
      'What happened',
      'User/Customer',
      'Correlation/Trace',
    ]);
    // Note: "Actions" is the 7th column but is deliberately not a registry
    // entry at all (see ResultsTable.tsx/columnRegistry.tsx's own comments) -
    // six registry defaults + the structurally-pinned Actions column = seven.
  });

  it('has 23 columns total, all with unique ids', () => {
    expect(COLUMN_REGISTRY.length).toBe(23);
    const ids = new Set(ALL_COLUMN_IDS);
    expect(ids.size).toBe(23);
  });

  it('never defines "actions" as a registry column id', () => {
    expect(COLUMN_REGISTRY_BY_ID.has('actions' as never)).toBe(false);
    expect(ALL_COLUMN_IDS).not.toContain('actions');
  });

  it('never exposes any of the five protected/sensitive fields as a dedicated column id or label', () => {
    for (const column of COLUMN_REGISTRY) {
      expect(SENSITIVE_FIELDS).not.toContain(column.id);
      for (const field of SENSITIVE_FIELDS) {
        expect(column.label.toLowerCase()).not.toContain(field.toLowerCase());
      }
    }
  });

  it('DEFAULT_COLUMN_ORDER contains every column id exactly once', () => {
    expect(DEFAULT_COLUMN_ORDER).toEqual(ALL_COLUMN_IDS);
    expect(new Set(DEFAULT_COLUMN_ORDER).size).toBe(DEFAULT_COLUMN_ORDER.length);
  });

  it('DEFAULT_HIDDEN_COLUMN_IDS is exactly every non-default-visible column (the 17 optional ones)', () => {
    expect(DEFAULT_HIDDEN_COLUMN_IDS).toHaveLength(17);
    const defaultVisibleIds = new Set(COLUMN_REGISTRY.filter((c) => c.defaultVisible).map((c) => c.id));
    for (const id of DEFAULT_HIDDEN_COLUMN_IDS) {
      expect(defaultVisibleIds.has(id)).toBe(false);
    }
  });

  it('includes exactly the mission-specified optional-column candidate list', () => {
    const optionalLabels = COLUMN_REGISTRY.filter((c) => !c.defaultVisible).map((c) => c.label).sort();
    expect(optionalLabels).toEqual(
      [
        'Logger',
        'Thread',
        'Trace ID',
        'Span ID',
        'Correlation ID',
        'Journey ID',
        'Event ID',
        'Error code',
        'Business step',
        'UI identifier',
        'Container',
        'Pod',
        'Namespace',
        'Compose project',
        'Compose service',
        'Device platform',
        'Language',
      ].sort(),
    );
  });

  describe('renderers', () => {
    it('every optional column renders EMPTY_VALUE for a sparse event, never throwing or rendering blank', () => {
      const event = sparseEvent();
      for (const column of COLUMN_REGISTRY.filter((c) => !c.defaultVisible)) {
        const { container, unmount } = render(<table><tbody><tr>{column.render(event, {})}</tr></tbody></table>);
        expect(container.textContent).toContain('—');
        unmount();
      }
    });

    it('every optional column renders its genuine field value for a fully-populated event', () => {
      const event = fullEvent();
      const cases: [string, string][] = [
        ['logger', event.logger!],
        ['thread', event.thread!],
        ['traceId', event.traceId!],
        ['spanId', event.spanId!],
        ['correlationId', event.correlationId!],
        ['journeyId', event.journeyId!],
        ['eventId', event.eventId!],
        ['errorCode', event.errorCode!],
        ['businessStep', event.businessStep!],
        ['uiIdentifier', event.uiIdentifier!],
        ['container', event.containerName!],
        ['devicePlatform', event.devicePlatformType!],
        ['language', event.language!],
      ];
      for (const [id, expected] of cases) {
        const column = COLUMN_REGISTRY_BY_ID.get(id as never)!;
        render(<table><tbody><tr>{column.render(event, {})}</tr></tbody></table>);
        expect(screen.getByText(expected)).toBeInTheDocument();
      }
    });

    it('the "composeService" column renders the Slice 3 backend field verbatim (non-sensitive infra id)', () => {
      const event = fullEvent({ composeService: 'payments' });
      const column = COLUMN_REGISTRY_BY_ID.get('composeService')!;
      render(<table><tbody><tr>{column.render(event, {})}</tr></tbody></table>);
      expect(screen.getByText('payments')).toBeInTheDocument();
    });

    it('the "container" column falls back from containerName to containerId', () => {
      const column = COLUMN_REGISTRY_BY_ID.get('container')!;
      const withName = fullEvent({ containerName: 'svc-1', containerId: 'abc123' });
      render(<table><tbody><tr>{column.render(withName, {})}</tr></tbody></table>);
      expect(screen.getByText('svc-1')).toBeInTheDocument();

      const withoutName = fullEvent({ containerName: null, containerId: 'abc123' });
      render(<table><tbody><tr>{column.render(withoutName, {})}</tr></tbody></table>);
      expect(screen.getByText('abc123')).toBeInTheDocument();
    });

    it('never renders a raw protected/sensitive field value even though the full event has one populated', () => {
      const event = fullEvent();
      const rawSensitiveValues = [
        event.protectedFields.cif,
        event.protectedFields.userName,
        event.protectedFields.customerId,
        event.protectedFields.deviceId,
        event.protectedFields.deviceIp,
      ];
      // None of the 17 optional columns' renderers reference `protectedFields`
      // at all (only `userCustomer` does, and only the already-masked
      // values) - assert none of the optional renderers happen to echo a
      // masked value verbatim in a way that would be a coincidence bug.
      for (const column of COLUMN_REGISTRY.filter((c) => !c.defaultVisible)) {
        const { container, unmount } = render(<table><tbody><tr>{column.render(event, {})}</tr></tbody></table>);
        for (const raw of rawSensitiveValues) {
          if (raw) {
            expect(container.textContent).not.toContain(raw);
          }
        }
        unmount();
      }
    });
  });
});
