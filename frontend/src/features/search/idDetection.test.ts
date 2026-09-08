import { describe, expect, it } from 'vitest';
import { detectIdCandidate } from './idDetection';

describe('detectIdCandidate', () => {
  it('returns null for ordinary short free text', () => {
    expect(detectIdCandidate('timeout')).toBeNull();
    expect(detectIdCandidate('')).toBeNull();
  });

  it('detects a UUID as a Trace ID candidate', () => {
    expect(detectIdCandidate('3fa85f64-5717-4562-b3fc-2c963f66afa6')).toEqual({
      field: 'traceId',
      fieldLabel: 'Trace ID',
    });
  });

  it('detects a 32-char hex string as a Trace ID candidate', () => {
    expect(detectIdCandidate('4bf92f3577b34da6a3ce929d0e0e4736')).toEqual({
      field: 'traceId',
      fieldLabel: 'Trace ID',
    });
  });

  it('detects a trace- prefixed value', () => {
    expect(detectIdCandidate('trace-000100')).toEqual({ field: 'traceId', fieldLabel: 'Trace ID' });
  });

  it('detects corr- and correlation- prefixed values as Correlation ID', () => {
    expect(detectIdCandidate('corr-abc123')).toEqual({ field: 'correlationId', fieldLabel: 'Correlation ID' });
    expect(detectIdCandidate('correlation-abc123')).toEqual({ field: 'correlationId', fieldLabel: 'Correlation ID' });
  });

  it('detects journey- and event- prefixed values', () => {
    expect(detectIdCandidate('journey-000001')).toEqual({ field: 'journeyId', fieldLabel: 'Journey ID' });
    expect(detectIdCandidate('event-000009')).toEqual({ field: 'eventId', fieldLabel: 'Event ID' });
  });

  it('does not classify ordinary prose that happens to be long', () => {
    expect(detectIdCandidate('connection timeout occurred while calling downstream')).toBeNull();
  });
});
