import { describe, expect, it } from 'vitest';
import {
  buildActorClientFields,
  buildBusinessFields,
  buildErrorFields,
  buildOverviewFields,
  buildRequestFlowIdentifiers,
  deriveExceptionSummary,
  eventHasErrorInfo,
  hasMeaningfulText,
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

// LIVE_TIME_INSPECTOR_AND_DOCUMENTATION_RECOVERY - split from the former buildBusinessErrorFields,
// owner decision: error/exception data must never mix into the business tab.
describe('buildBusinessFields', () => {
  it('a full event lists business step and UI identifier only - never error code', () => {
    const fields = buildBusinessFields(fullEvent());
    expect(fields.map((f) => f.label)).toEqual(['Business step', 'UI identifier']);
  });

  it('a sparse event produces no rows', () => {
    expect(buildBusinessFields(sparseEvent())).toEqual([]);
  });
});

describe('buildErrorFields', () => {
  it('a full event lists error code', () => {
    const fields = buildErrorFields(fullEvent());
    expect(fields.map((f) => f.label)).toEqual(['Error code']);
  });

  it('a sparse event produces no rows', () => {
    expect(buildErrorFields(sparseEvent())).toEqual([]);
  });

  // PR65_OWNER_REVIEW_DOCUMENTATION_AND_ERROR_EDGE_RECOVERY
  it('a whitespace-only error code produces no rows - it is not real error information', () => {
    expect(buildErrorFields(sparseEvent({ errorCode: '   ' }))).toEqual([]);
  });
});

describe('eventHasErrorInfo', () => {
  it('is true for ERROR severity', () => {
    expect(eventHasErrorInfo(sparseEvent({ severity: 'ERROR' }))).toBe(true);
  });

  it('is true for FATAL severity, case-insensitively', () => {
    expect(eventHasErrorInfo(sparseEvent({ severity: 'fatal' }))).toBe(true);
  });

  it('is true for a non-empty exception, regardless of severity', () => {
    expect(eventHasErrorInfo(sparseEvent({ severity: 'INFO', exception: 'boom' }))).toBe(true);
  });

  it('is true for a non-empty error code, regardless of severity', () => {
    expect(eventHasErrorInfo(sparseEvent({ severity: 'WARN', errorCode: 'ERR_X' }))).toBe(true);
  });

  it('is false for a plain INFO event with no exception or error code', () => {
    expect(eventHasErrorInfo(sparseEvent({ severity: 'INFO' }))).toBe(false);
  });

  it('is false for a fully sparse event (null severity)', () => {
    expect(eventHasErrorInfo(sparseEvent())).toBe(false);
  });

  it('a full event (ERROR + exception + errorCode) is true', () => {
    expect(eventHasErrorInfo(fullEvent())).toBe(true);
  });

  // PR65_OWNER_REVIEW_DOCUMENTATION_AND_ERROR_EDGE_RECOVERY - `"   "` is truthy but carries no real
  // information; it must not manufacture error info that isn't actually there.
  it('is false for a non-error event with a whitespace-only exception and error code', () => {
    expect(eventHasErrorInfo(sparseEvent({ severity: 'INFO', exception: '   ', errorCode: '\t\n ' }))).toBe(false);
  });

  it('is true for ERROR severity even when exception and error code are both whitespace-only', () => {
    expect(eventHasErrorInfo(sparseEvent({ severity: 'ERROR', exception: '  ', errorCode: ' ' }))).toBe(true);
  });
});

describe('hasMeaningfulText', () => {
  it('is false for null, undefined, empty string and whitespace-only strings', () => {
    expect(hasMeaningfulText(null)).toBe(false);
    expect(hasMeaningfulText(undefined)).toBe(false);
    expect(hasMeaningfulText('')).toBe(false);
    expect(hasMeaningfulText('   ')).toBe(false);
    expect(hasMeaningfulText('\t\n  ')).toBe(false);
  });

  it('is true for any non-blank text', () => {
    expect(hasMeaningfulText('ERR_X')).toBe(true);
    expect(hasMeaningfulText('  ERR_X  ')).toBe(true);
  });
});

describe('deriveExceptionSummary', () => {
  it('extracts the exception type from a real Java "pkg.Type: message" shape', () => {
    const result = deriveExceptionSummary('java.lang.RuntimeException: timeout\n\tat com.example.Foo.bar(Foo.java:1)');
    expect(result.exceptionType).toBe('java.lang.RuntimeException');
    expect(result.preview).toBe('timeout');
  });

  it('never fabricates a type when the first line does not look like that shape', () => {
    const result = deriveExceptionSummary('something went wrong, no colon-qualified type here');
    expect(result.exceptionType).toBeNull();
    expect(result.preview).toBe('something went wrong, no colon-qualified type here');
  });

  it('uses only the first line as the preview even for a long multiline trace', () => {
    const result = deriveExceptionSummary('java.io.IOException: disk full\nline2\nline3');
    expect(result.exceptionType).toBe('java.io.IOException');
    expect(result.preview).toBe('disk full');
  });
});
