import { describe, expect, it } from 'vitest';
import type { SourceInfo } from '../../shared/api/types';
import {
  firstSelectableSourceId,
  isSourceSelectableInUi,
  orderSourcesForSelector,
  sourceOptionLabel,
} from './sourcePolicy';

const CAPS = {
  historicalSearch: true,
  liveTail: false,
  rawLogQL: false,
  serviceDiscovery: false,
  queryStatistics: false,
  contextView: false,
  composeProjectScoping: false,
  originalSchemaSampling: false,
};

function source(id: string, displayName: string): SourceInfo {
  return { id, displayName, capabilities: CAPS };
}

const DOCKER = source('local-docker', 'Local Docker');
const OPENSHIFT = source('openshift', 'OpenShift');
const LOKI = source('openshift-loki', 'OpenShift Loki');
const FIXTURE = source('fixture', 'Fixture (dev/test only)');

describe('source selector policy', () => {
  it('orders Docker, OpenShift, OpenShift Loki by stable id regardless of API order', () => {
    for (const apiOrder of [[LOKI, OPENSHIFT, DOCKER], [OPENSHIFT, LOKI, DOCKER], [DOCKER, LOKI, OPENSHIFT]]) {
      expect(orderSourcesForSelector(apiOrder).map((s) => s.id)).toEqual(['local-docker', 'openshift', 'openshift-loki']);
    }
  });

  it('keeps other sources (dev-only Fixture) available, after the three production sources, in their original order', () => {
    const extra = source('some-future-source', 'Future');
    expect(orderSourcesForSelector([FIXTURE, LOKI, extra, OPENSHIFT, DOCKER]).map((s) => s.id)).toEqual([
      'local-docker', 'openshift', 'openshift-loki', 'fixture', 'some-future-source',
    ]);
    expect(isSourceSelectableInUi('fixture')).toBe(true);
  });

  it('does not depend on display names', () => {
    const renamed = [source('openshift-loki', 'Docker'), source('local-docker', 'Something else')];
    expect(orderSourcesForSelector(renamed).map((s) => s.id)).toEqual(['local-docker', 'openshift-loki']);
  });

  it('marks only OpenShift Loki as not selectable, with a "Not available" label', () => {
    expect(isSourceSelectableInUi('openshift-loki')).toBe(false);
    expect(isSourceSelectableInUi('local-docker')).toBe(true);
    expect(isSourceSelectableInUi('openshift')).toBe(true);
    expect(sourceOptionLabel(LOKI)).toBe('OpenShift Loki — Not available');
    expect(sourceOptionLabel(DOCKER)).toBe('Local Docker');
  });

  it('falls back to Docker, then OpenShift, then another selectable source, never Loki', () => {
    expect(firstSelectableSourceId([LOKI, OPENSHIFT, DOCKER, FIXTURE])).toBe('local-docker');
    expect(firstSelectableSourceId([LOKI, FIXTURE, OPENSHIFT])).toBe('openshift');
    expect(firstSelectableSourceId([LOKI, FIXTURE])).toBe('fixture');
    expect(firstSelectableSourceId([LOKI])).toBeNull();
    expect(firstSelectableSourceId([])).toBeNull();
  });
});
