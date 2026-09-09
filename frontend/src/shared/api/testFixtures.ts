import type { QueryPlan } from './types';

/** A neutral "nothing to report" query plan, for test fixtures that don't care about query-plan content. */
export const EMPTY_QUERY_PLAN: QueryPlan = {
  resolvedQuery: '(no query)',
  rawLogQlMode: false,
  pushedDownConditions: [],
  postFilterConditions: [],
  notes: [],
};
