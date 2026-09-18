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
  /*
   * The default set was seven columns until the owner mission "Classification real search scope, assisted
   * extraction, and visual tagging" §"Fourth owner requirement" made classification visible in the table by
   * default: a saved rule must be discoverable after a re-search without opening the inspector. Tags is the
   * eighth column, formally superseding the previous contract (CLAUDE.md §4, docs/governance/
   * OWNER_REQUIREMENTS_REGISTER.md). Everything else about the contract is unchanged - one table, one colgroup,
   * one row per event, no omitted cells, "What happened" message-only, Actions pinned last.
   */
  it('has exactly eight default-visible columns, in the required order, with the required labels', () => {
    const defaults = COLUMN_REGISTRY.filter((c) => c.defaultVisible);
    expect(defaults.map((c) => c.id)).toEqual([
      'time',
      'level',
      'service',
      'whatHappened',
      'tags',
      'userCustomer',
      'correlationTrace',
    ]);
    expect(defaults.map((c) => c.label)).toEqual([
      'Time',
      'Level',
      'Service',
      'What happened',
      'Tags',
      'User / Customer',
      'Correlation / Trace',
    ]);
    // Note: "Actions" is the last column but is deliberately not a registry
    // entry at all (see ResultsTable.tsx/columnRegistry.tsx's own comments) -
    // seven registry defaults + the structurally-pinned Actions column = eight.
  });

  it('has 24 columns total, all with unique ids', () => {
    expect(COLUMN_REGISTRY.length).toBe(24);
    const ids = new Set(ALL_COLUMN_IDS);
    expect(ids.size).toBe(24);
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

    /*
     * COMPONENT_INVENTORY.md "severity mark in a 22 px gutter inside the Time cell" (B3 restyle) -
     * additive to the Level column's own coloured text, decorative (aria-hidden), shape-differentiated
     * per level so the cue never relies on colour alone.
     */
    it('the "time" column renders a shape-differentiated, decorative severity mark for every known level', () => {
      const shapeByLevel: Record<string, string> = {
        ERROR: 'sevMarkError',
        WARN: 'sevMarkWarn',
        INFO: 'sevMarkInfo',
        DEBUG: 'sevMarkDebug',
        TRACE: 'sevMarkTrace',
      };
      const column = COLUMN_REGISTRY_BY_ID.get('time')!;
      for (const [severity, shapeClass] of Object.entries(shapeByLevel)) {
        const event = fullEvent({ severity });
        const { container, unmount } = render(<table><tbody><tr>{column.render(event, {})}</tr></tbody></table>);
        const mark = container.querySelector('[class*="sevMark"]');
        expect(mark).not.toBeNull();
        expect(mark!.className).toMatch(new RegExp(shapeClass));
        expect(mark!.getAttribute('aria-hidden')).toBe('true');
        unmount();
      }
    });

    it('the "time" column renders no severity mark for a null/unknown severity', () => {
      const column = COLUMN_REGISTRY_BY_ID.get('time')!;
      const event = fullEvent({ severity: null });
      const { container } = render(<table><tbody><tr>{column.render(event, {})}</tr></tbody></table>);
      expect(container.querySelector('[class*="sevMark"]')).toBeNull();
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
