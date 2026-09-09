import { describe, expect, it } from 'vitest';
import {
  EMPTY_VALUE,
  formatTimestampCell,
  listCopyableIdentifiers,
  resolveCorrelationOrTrace,
  resolveService,
  resolveUserOrCustomer,
  resolveWhatHappened,
} from './columnMapping';
import type { LogEvent } from '../../shared/api/types';

function baseEvent(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    timestamp: '2026-01-01T00:00:00.500Z',
    timestampRaw: '2026-01-01T00:00:00.500Z',
    schemaVersion: '1',
    service: 'gateway',
    serviceSourceHint: 'gateway-compose',
    severity: 'INFO',
    severityNumber: 20000,
    message: 'connection timeout',
    logger: 'com.example.Gateway',
    thread: 'main',
    exception: null,
    traceId: 'trace-1',
    spanId: 'span-1',
    journeyId: null,
    eventId: null,
    businessStep: null,
    uiIdentifier: null,
    errorCode: null,
    correlationId: 'corr-1',
    protectedFields: { cif: null, userName: 'al***e', customerId: null, deviceId: null, deviceIp: null },
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
    ...overrides,
  };
}

describe('resolveService', () => {
  it('prefers the parsed application field', () => {
    expect(resolveService(baseEvent())).toBe('gateway');
  });

  it('falls back to serviceSourceHint (Compose service) when application is missing', () => {
    expect(resolveService(baseEvent({ service: null }))).toBe('gateway-compose');
  });

  it('renders the empty placeholder when neither is present', () => {
    expect(resolveService(baseEvent({ service: null, serviceSourceHint: null }))).toBe(EMPTY_VALUE);
  });
});

describe('resolveWhatHappened', () => {
  it('shows the message, never the service, for an ordinary event', () => {
    const cell = resolveWhatHappened(baseEvent());
    expect(cell).toEqual({ text: 'connection timeout', malformed: false });
  });

  it('shows the raw line, marked malformed, for a malformed event', () => {
    const cell = resolveWhatHappened(baseEvent({ malformed: true, message: null, rawLine: 'NOT-JSON garbage' }));
    expect(cell).toEqual({ text: 'NOT-JSON garbage', malformed: true });
  });

  it('shows the empty placeholder for a truly empty message (never invents one)', () => {
    // Regression test for a real bug found via Phase M's real-browser UX
    // acceptance testing: this used to return a literal empty string for
    // message: '' - an invisible, effectively omitted cell, not a
    // fallback at all (CLAUDE.md §4 "Parsing": "the UI shows a display
    // fallback like `(empty message)`"). Distinct from message: null (the
    // field was never present), which still falls back to the ordinary
    // EMPTY_VALUE every other missing-value cell in this table uses.
    expect(resolveWhatHappened(baseEvent({ message: '' }))).toEqual({ text: '(empty message)', malformed: false });
    expect(resolveWhatHappened(baseEvent({ message: null }))).toEqual({ text: EMPTY_VALUE, malformed: false });
  });
});

describe('resolveUserOrCustomer', () => {
  it('prefers the masked user name', () => {
    expect(resolveUserOrCustomer(baseEvent())).toEqual({ label: 'User', value: 'al***e' });
  });

  it('falls back to the masked customer id', () => {
    const event = baseEvent({ protectedFields: { cif: null, userName: null, customerId: 'cu***1', deviceId: null, deviceIp: null } });
    expect(resolveUserOrCustomer(event)).toEqual({ label: 'Customer', value: 'cu***1' });
  });

  it('returns null when neither is present (renderer shows the placeholder)', () => {
    const event = baseEvent({ protectedFields: { cif: null, userName: null, customerId: null, deviceId: null, deviceIp: null } });
    expect(resolveUserOrCustomer(event)).toBeNull();
  });

  it('never returns a raw (unmasked-looking) value - only ever what protectedFields already carries', () => {
    const event = baseEvent({ protectedFields: { cif: null, userName: 'already-masked-value', customerId: null, deviceId: null, deviceIp: null } });
    expect(resolveUserOrCustomer(event)?.value).toBe('already-masked-value');
  });
});

describe('resolveCorrelationOrTrace', () => {
  it('prefers traceId', () => {
    expect(resolveCorrelationOrTrace(baseEvent())).toEqual({ label: 'Trace ID', value: 'trace-1', field: 'traceId' });
  });

  it('falls back to correlationId', () => {
    expect(resolveCorrelationOrTrace(baseEvent({ traceId: null }))).toEqual({
      label: 'Correlation ID',
      value: 'corr-1',
      field: 'correlationId',
    });
  });

  it('returns null when neither is present', () => {
    expect(resolveCorrelationOrTrace(baseEvent({ traceId: null, correlationId: null }))).toBeNull();
  });
});

describe('formatTimestampCell', () => {
  it('includes the date, time, and milliseconds', () => {
    const label = formatTimestampCell('2026-01-01T00:00:00.500Z');
    expect(label).toMatch(/2026/);
    expect(label).toMatch(/500/);
  });

  it('renders the empty placeholder for a null timestamp (malformed events)', () => {
    expect(formatTimestampCell(null)).toBe(EMPTY_VALUE);
  });

  it('renders the empty placeholder for an unparseable timestamp rather than "Invalid Date"', () => {
    expect(formatTimestampCell('not-a-real-timestamp')).toBe(EMPTY_VALUE);
  });
});

describe('listCopyableIdentifiers', () => {
  it('lists every present non-sensitive identifier', () => {
    const event = baseEvent({ journeyId: 'journey-1', eventId: 'event-1' });
    const ids = listCopyableIdentifiers(event);
    expect(ids).toEqual([
      { label: 'Trace ID', value: 'trace-1' },
      { label: 'Span ID', value: 'span-1' },
      { label: 'Correlation ID', value: 'corr-1' },
      { label: 'Journey ID', value: 'journey-1' },
      { label: 'Event ID', value: 'event-1' },
    ]);
  });

  it('omits any identifier that is absent, rather than listing a blank entry', () => {
    const event = baseEvent({ spanId: null, journeyId: null, eventId: null });
    expect(listCopyableIdentifiers(event)).toEqual([
      { label: 'Trace ID', value: 'trace-1' },
      { label: 'Correlation ID', value: 'corr-1' },
    ]);
  });

  it('returns an empty list for a malformed event with no parsed identifiers', () => {
    const event = baseEvent({ traceId: null, spanId: null, correlationId: null, journeyId: null, eventId: null });
    expect(listCopyableIdentifiers(event)).toEqual([]);
  });
});
