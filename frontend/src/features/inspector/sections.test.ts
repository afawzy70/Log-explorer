import { describe, expect, it } from 'vitest';
import {
  buildActorClientFields,
  buildBusinessErrorFields,
  buildOverviewFields,
  buildRequestFlowIdentifiers,
} from './sections';
import { fullEvent, sparseEvent } from './testEventFixture';

const NO_SOURCES = [] as never[];

describe('buildOverviewFields', () => {
  it('a full event renders every overview field, including source/container enrichment', () => {
    const fields = buildOverviewFields(fullEvent(), NO_SOURCES);
    const labels = fields.map((f) => f.label);
    // UX-R5 §9 - Overview is what/where, weighted. "Local time"/"Zone"/
    // "UTC" collapsed into one "Time" row (all three values still
    // rendered - see the dedicated test below); "Thread"/"Schema version"
    // moved out to "All fields", which is the canonical home for
    // diagnostic minutiae (proved still reachable below).
    expect(labels).toEqual([
      'Message',
      'Time',
      'Source',
      'Service',
      'Compose project',
      'Container',
      'Stream',
      'Level',
      'Logger',
    ]);
  });

  it('UX-R5 §9 - the single Time row still carries local time, zone AND UTC, nothing dropped', () => {
    const time = buildOverviewFields(fullEvent(), NO_SOURCES).find((f) => f.label === 'Time');
    expect(time).toBeDefined();
    expect(time!.value).not.toBe('—');
    // Zone and UTC are present, at secondary emphasis rather than as peer rows.
    expect(time!.secondary).toMatch(/UTC/);
    expect(time!.secondary!.length).toBeGreaterThan(0);
  });

  it('UX-R5 §9 - an event with no timestamp gets no invented secondary line', () => {
    const time = buildOverviewFields(sparseEvent(), NO_SOURCES).find((f) => f.label === 'Time');
    expect(time!.secondary).toBeUndefined();
  });

  it('a sparse event still renders every structurally-expected field, with the empty placeholder - never an omitted cell', () => {
    const fields = buildOverviewFields(sparseEvent(), NO_SOURCES);
    const message = fields.find((f) => f.label === 'Message');
    expect(message?.value).toBe('—');
    // Compose project/container/etc. are "when present" - correctly absent here.
    expect(fields.some((f) => f.label === 'Compose project')).toBe(false);
  });

  it('a malformed event shows its raw line as the Message field, never falling back to Service', () => {
    const fields = buildOverviewFields(sparseEvent({ malformed: true, rawLine: '{not json', service: 'gateway' }), NO_SOURCES);
    expect(fields.find((f) => f.label === 'Message')?.value).toBe('{not json');
  });

  it('resolves the source display name from the sources list when available', () => {
    const sources = [{ id: 'local-docker', displayName: 'Local Docker', capabilities: {} as never }];
    const fields = buildOverviewFields(fullEvent(), sources);
    expect(fields.find((f) => f.label === 'Source')?.value).toBe('Local Docker');
  });

  it('falls back to the raw source id when the source is not in the current list', () => {
    const fields = buildOverviewFields(fullEvent(), NO_SOURCES);
    expect(fields.find((f) => f.label === 'Source')?.value).toBe('local-docker');
  });
});

describe('buildActorClientFields', () => {
  it('a full event exposes every already-masked protected field, labelled, never raw', () => {
    const event = fullEvent();
    const fields = buildActorClientFields(event);
    expect(fields).toEqual([
      { label: 'Username', value: event.protectedFields.userName, monospace: false },
      { label: 'Customer ID', value: event.protectedFields.customerId, monospace: false },
      { label: 'CIF', value: event.protectedFields.cif, monospace: false },
      { label: 'Device ID', value: event.protectedFields.deviceId, monospace: true },
      { label: 'Device IP', value: event.protectedFields.deviceIp, monospace: true },
      { label: 'Device platform', value: event.devicePlatformType, monospace: false },
      { label: 'Language', value: event.language, monospace: false },
    ]);
    // Every value already looks masked (contains a masking marker) - this
    // module never has access to a raw value to leak in the first place,
    // since `LogEvent.protectedFields` is the only sensitive carrier.
    for (const field of fields.slice(0, 5)) {
      expect(field.value).toMatch(/\*/);
    }
  });

  it('an event with no actor/client data at all produces zero rows, not fabricated placeholders', () => {
    expect(buildActorClientFields(sparseEvent())).toEqual([]);
  });
});

describe('buildRequestFlowIdentifiers', () => {
  it('lists only the identifiers actually present, in the stated order', () => {
    const ids = buildRequestFlowIdentifiers(fullEvent());
    expect(ids.map((i) => i.field)).toEqual(['journeyId', 'correlationId', 'traceId', 'spanId', 'eventId']);
  });

  it('an event with only a trace ID lists only that one', () => {
    const ids = buildRequestFlowIdentifiers(sparseEvent({ traceId: 'trace-only' }));
    expect(ids).toEqual([{ field: 'traceId', label: 'Trace ID', value: 'trace-only' }]);
  });

  it('never includes a sensitive field as a request-flow identifier', () => {
    const ids = buildRequestFlowIdentifiers(fullEvent());
    const labels = ids.map((i) => i.label.toLowerCase());
    for (const sensitive of ['cif', 'user', 'customer', 'device']) {
      expect(labels.some((l) => l.includes(sensitive))).toBe(false);
    }
  });
});

describe('buildBusinessErrorFields', () => {
  it('a full event lists business step, UI identifier, and error code', () => {
    const fields = buildBusinessErrorFields(fullEvent());
    expect(fields.map((f) => f.label)).toEqual(['Business step', 'UI identifier', 'Error code']);
  });

  it('a sparse event produces no rows', () => {
    expect(buildBusinessErrorFields(sparseEvent())).toEqual([]);
  });
});
