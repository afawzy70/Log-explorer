import { describe, expect, it } from 'vitest';
import { countDistinctServices, countDistinctTraces, JOURNEY_FIELD_LABELS } from './journeyFields';
import { fullEvent, sparseEvent } from '../inspector/testEventFixture';

describe('countDistinctTraces', () => {
  it('"Supports multiple traces within one journey" (IMPLEMENTATION_PLAN.md "Phase I" scope item 3) - counts every distinct traceId', () => {
    const entries = [
      fullEvent({ traceId: 'trace-1' }),
      fullEvent({ traceId: 'trace-2' }),
      fullEvent({ traceId: 'trace-1' }),
    ];
    expect(countDistinctTraces(entries)).toBe(2);
  });

  it('events with no traceId at all do not count', () => {
    expect(countDistinctTraces([sparseEvent(), sparseEvent()])).toBe(0);
  });
});

describe('countDistinctServices', () => {
  it('counts every distinct service', () => {
    const entries = [fullEvent({ service: 'a' }), fullEvent({ service: 'b' }), fullEvent({ service: 'a' })];
    expect(countDistinctServices(entries)).toBe(2);
  });
});

describe('JOURNEY_FIELD_LABELS', () => {
  it('covers exactly the four non-sensitive click-action fields, never a sensitive one', () => {
    expect(Object.keys(JOURNEY_FIELD_LABELS).sort()).toEqual(
      ['correlationId', 'eventId', 'journeyId', 'traceId'].sort(),
    );
  });
});
