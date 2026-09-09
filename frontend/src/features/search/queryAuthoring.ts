/**
 * The guided query builder's canonical authoring state (Legacy Remediation
 * Slice 2, `docs/LEGACY_TO_NEW_REMEDIATION_PLAN.md` §"Slice 2" - "Define
 * one canonical authoring state and explicit conversion behavior").
 *
 * This is deliberately an AUTHORING surface for the existing backend DSL
 * (`core.query.QueryParser`), never a second query language: `serializeTree`
 * only ever prints fixed grammar vocabulary the user already chose from
 * closed lists (`QUERY_FIELDS`, `QUERY_OPERATORS`) plus the user's own typed
 * literal values, string-escaped the same way the backend lexer expects -
 * it never interprets, evaluates, or reinterprets query semantics itself.
 * There is deliberately no reverse (text -> tree) parser here: building one
 * would duplicate `core.query.QueryParser`'s own grammar, which the mission
 * explicitly forbids ("Do NOT create another backend query language... a
 * second parser"). See `QueryBuilder.tsx` for how mode switching therefore
 * treats guided->text as always-safe (pure serialization) and text->guided
 * as a destructive, explicitly-confirmed reset instead of a fabricated
 * conversion.
 */

export type QueryFieldAlias =
  | 'service' | 'level' | 'message' | 'logger' | 'traceId' | 'spanId' | 'correlationId'
  | 'journeyId' | 'eventId' | 'errorCode' | 'businessStep' | 'uiIdentifier' | 'device.platform'
  | 'language' | 'userName' | 'customerId' | 'cif';

export type QueryOperator = '=' | '!=' | 'contains';

export interface QueryFieldDef {
  alias: QueryFieldAlias;
  label: string;
  /** Mirrors `core.query.QueryFields.SENSITIVE_ALIASES` - "contains" is never offered for these (CLAUDE.md §2 rule 1). */
  sensitive: boolean;
}

/** The DSL's full 17-alias vocabulary (HANDOVER.md §9), mirroring `core.query.QueryFields`. */
export const QUERY_FIELDS: QueryFieldDef[] = [
  { alias: 'service', label: 'Service', sensitive: false },
  { alias: 'level', label: 'Level', sensitive: false },
  { alias: 'message', label: 'Message', sensitive: false },
  { alias: 'logger', label: 'Logger', sensitive: false },
  { alias: 'traceId', label: 'Trace ID', sensitive: false },
  { alias: 'spanId', label: 'Span ID', sensitive: false },
  { alias: 'correlationId', label: 'Correlation ID', sensitive: false },
  { alias: 'journeyId', label: 'Journey ID', sensitive: false },
  { alias: 'eventId', label: 'Event ID', sensitive: false },
  { alias: 'errorCode', label: 'Error code', sensitive: false },
  { alias: 'businessStep', label: 'Business step', sensitive: false },
  { alias: 'uiIdentifier', label: 'UI identifier', sensitive: false },
  { alias: 'device.platform', label: 'Device platform', sensitive: false },
  { alias: 'language', label: 'Language', sensitive: false },
  { alias: 'userName', label: 'User name', sensitive: true },
  { alias: 'customerId', label: 'Customer ID', sensitive: true },
  { alias: 'cif', label: 'CIF', sensitive: true },
];

/**
 * Operators offered for `field` - "contains" is omitted for a sensitive
 * field (Legacy Remediation Slice 2: "sensitive fields are exact-match
 * lookup only", CLAUDE.md §2 rule 1). The backend (`QueryParser`) is the
 * authoritative enforcement point regardless; this only keeps the guided
 * builder from ever *offering* the rejected shape in the first place.
 */
export function operatorsFor(field: QueryFieldAlias): QueryOperator[] {
  const def = QUERY_FIELDS.find((f) => f.alias === field);
  return def?.sensitive ? ['=', '!='] : ['=', '!=', 'contains'];
}

export interface QueryCondition {
  kind: 'condition';
  id: string;
  field: QueryFieldAlias;
  operator: QueryOperator;
  value: string;
}

export interface QueryGroup {
  kind: 'group';
  id: string;
  combinator: 'AND' | 'OR';
  children: QueryNode[];
}

export type QueryNode = QueryCondition | QueryGroup;

/**
 * The guided builder never nests deeper than this (Legacy Remediation
 * Slice 2: "a documented bounded nesting depth" - the root group is depth
 * 0, so depth 1 allows exactly one level of subgroup, e.g. `service = X
 * AND (level = ERROR OR level = WARN)`). The backend parser itself has no
 * such limit beyond its own much larger defensive bound
 * (`QueryParser.MAX_DEPTH`, 60) - a query typed directly as text can be
 * arbitrarily deeper; only the *visual* builder is bounded.
 */
export const MAX_GUIDED_DEPTH = 1;

let nextId = 0;
function newId(): string {
  nextId += 1;
  return `qn-${nextId}-${Date.now().toString(36)}`;
}

export function emptyCondition(): QueryCondition {
  return { kind: 'condition', id: newId(), field: 'service', operator: '=', value: '' };
}

export function emptyGroup(combinator: 'AND' | 'OR' = 'AND'): QueryGroup {
  return { kind: 'group', id: newId(), combinator, children: [] };
}

export function depthOf(group: QueryGroup): number {
  let max = 0;
  for (const child of group.children) {
    if (child.kind === 'group') {
      max = Math.max(max, 1 + depthOf(child));
    }
  }
  return max;
}

/** Escapes a literal exactly the way `core.query.QueryLexer` expects to unescape it back - backslash first, then quote. */
export function escapeDslString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function renderCondition(node: QueryCondition): string {
  return `${node.field} ${node.operator} "${escapeDslString(node.value)}"`;
}

function renderChild(node: QueryNode): string {
  if (node.kind === 'condition') {
    return renderCondition(node);
  }
  const inner = renderGroupChildren(node);
  return inner === '' ? '' : `(${inner})`;
}

function renderGroupChildren(group: QueryGroup): string {
  return group.children
    .map(renderChild)
    .filter((s) => s !== '')
    .join(` ${group.combinator} `);
}

/**
 * Deterministically serializes the guided tree into the existing textual
 * DSL - the ONLY direction this module ever converts in (see the module
 * doc comment for why there is no reverse parser). Empty (no children)
 * serializes to `''`, meaning "no DSL filter" - the same meaning
 * `core.query.QueryParser.parse` already gives a blank string.
 */
export function serializeQueryTree(root: QueryGroup): string {
  return renderGroupChildren(root);
}

export function hasAnyCondition(node: QueryNode): boolean {
  if (node.kind === 'condition') {
    return true;
  }
  return node.children.some(hasAnyCondition);
}

/** Depth of `groupId` within `root` (root itself is depth 0), or `null` if not found. */
function depthOfGroup(node: QueryNode, groupId: string, depth: number): number | null {
  if (node.kind !== 'group') {
    return null;
  }
  if (node.id === groupId) {
    return depth;
  }
  for (const child of node.children) {
    const found = depthOfGroup(child, groupId, depth + 1);
    if (found != null) {
      return found;
    }
  }
  return null;
}

function mapGroup(node: QueryGroup, groupId: string, fn: (g: QueryGroup) => QueryGroup): QueryGroup {
  if (node.id === groupId) {
    return fn(node);
  }
  return {
    ...node,
    children: node.children.map((child) => (child.kind === 'group' ? mapGroup(child, groupId, fn) : child)),
  };
}

export function addCondition(root: QueryGroup, groupId: string): QueryGroup {
  return mapGroup(root, groupId, (g) => ({ ...g, children: [...g.children, emptyCondition()] }));
}

/** No-ops if `groupId` is already at {@link MAX_GUIDED_DEPTH} - the caller (`QueryBuilder`) should disable the affordance instead of relying on this silently, but this stays safe either way. */
export function addGroup(root: QueryGroup, groupId: string): QueryGroup {
  const depth = depthOfGroup(root, groupId, 0);
  if (depth == null || depth >= MAX_GUIDED_DEPTH) {
    return root;
  }
  return mapGroup(root, groupId, (g) => ({ ...g, children: [...g.children, emptyGroup(g.combinator === 'AND' ? 'OR' : 'AND')] }));
}

export function setGroupCombinator(root: QueryGroup, groupId: string, combinator: 'AND' | 'OR'): QueryGroup {
  return mapGroup(root, groupId, (g) => ({ ...g, combinator }));
}

export function updateCondition(root: QueryGroup, conditionId: string, patch: Partial<Omit<QueryCondition, 'kind' | 'id'>>): QueryGroup {
  function walk(node: QueryGroup): QueryGroup {
    return {
      ...node,
      children: node.children.map((child) => {
        if (child.kind === 'condition') {
          return child.id === conditionId ? { ...child, ...patch } : child;
        }
        return walk(child);
      }),
    };
  }
  return walk(root);
}

/** Removes any node (condition or subgroup) by id, anywhere in the tree. Removing the root's own id is a no-op - the root is never removable, only clearable via a fresh {@link emptyGroup}. */
export function removeNode(root: QueryGroup, nodeId: string): QueryGroup {
  function walk(node: QueryGroup): QueryGroup {
    return {
      ...node,
      children: node.children
        .filter((child) => child.id !== nodeId)
        .map((child) => (child.kind === 'group' ? walk(child) : child)),
    };
  }
  return walk(root);
}
