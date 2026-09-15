import { ApiError } from '../../../shared/api/client';
import type {
  ClassificationRule,
  ClassificationRuleField,
  ExtractionDefinition,
  LogEvent,
  RuleCondition,
  RuleMatcher,
  RuleValidationError,
} from '../../../shared/api/types';

/** Shown for every `RULES_REVISION_CONFLICT` - the draft is always kept. */
export const REVISION_CONFLICT_MESSAGE = 'These rules were changed elsewhere. Reload the latest rules, then save again.';

export const SAVED_MESSAGE = 'Rule saved. Re-run Search to classify currently loaded results.';

export const MATCHER_LABELS: Record<RuleMatcher, string> = {
  EXACT: 'Exact',
  CONTAINS: 'Contains',
  STARTS_WITH: 'Starts with',
  REGEX: 'Regular expression (RE2)',
};

/**
 * The five protected fields are never offered as an anchor for pattern
 * detection: the browser only ever holds their masked form, which cannot
 * describe the raw values the server samples.
 */
const PROTECTED_FIELD_KEYS = new Set(['cif', 'userName', 'customerId', 'deviceId', 'deviceIp']);

/** Comma-separated input -> trimmed, lowercase, de-duplicated, non-empty tags. The server remains the authority on tag format. */
export function normalizeTags(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(',')) {
    const tag = part.trim().toLowerCase();
    if (tag) {
      seen.add(tag);
    }
  }
  return Array.from(seen);
}

/** Reads a FieldRef (`<canonical key>`, `extra.<key>`, `mdc.<key>`) off an already-parsed, already-masked event. */
export function eventFieldValue(event: LogEvent, field: string): unknown {
  if (field.startsWith('extra.')) {
    return event.unknownTopLevelFields?.[field.slice('extra.'.length)];
  }
  if (field.startsWith('mdc.')) {
    return event.unknownMdcFields?.[field.slice('mdc.'.length)];
  }
  if (PROTECTED_FIELD_KEYS.has(field)) {
    return event.protectedFields?.[field as keyof LogEvent['protectedFields']];
  }
  if (field === 'service') {
    return event.service ?? event.serviceSourceHint;
  }
  const record = event as unknown as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(record, field) ? record[field] : undefined;
}

/** Text for display/anchoring; non-strings are JSON-stringified. `''` for null/undefined. */
export function stringifyFieldValue(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export interface FieldOption {
  key: string;
  label: string;
}

/** Canonical fields with a non-empty value on this event (protected fields excluded), then its unmapped top-level and MDC keys. */
export function eventFieldOptions(event: LogEvent, fields: ClassificationRuleField[]): FieldOption[] {
  const canonical = fields
    .filter((f) => !PROTECTED_FIELD_KEYS.has(f.key) && stringifyFieldValue(eventFieldValue(event, f.key)) !== '')
    .map((f) => ({ key: f.key, label: `${f.label} (${f.key})` }));
  const extra = Object.keys(event.unknownTopLevelFields ?? {}).map((k) => ({ key: `extra.${k}`, label: `extra.${k}` }));
  const mdc = Object.keys(event.unknownMdcFields ?? {}).map((k) => ({ key: `mdc.${k}`, label: `mdc.${k}` }));
  return [...canonical, ...extra, ...mdc];
}

/** "message · STARTS_WITH" for one condition, "2 conditions (ALL)" for several. */
export function conditionSummary(rule: ClassificationRule): string {
  const conditions = rule.conditions ?? [];
  if (conditions.length === 0) {
    return 'No conditions';
  }
  if (conditions.length === 1) {
    return `${conditions[0].field} · ${conditions[0].matcher}`;
  }
  return `${conditions.length} conditions (${rule.matchMode ?? 'ALL'})`;
}

export function emptyRule(): ClassificationRule {
  return { name: '', description: '', tags: [], enabled: true, matchMode: 'ALL', conditions: [], extractions: [] };
}

/** Prefilled copy for "Duplicate" - no id, so saving creates a new rule. */
export function duplicateRule(rule: ClassificationRule): ClassificationRule {
  const copy = toWritableRule(rule, false);
  return { ...copy, name: `Copy of ${rule.name}` };
}

function cleanExtraction(x: ExtractionDefinition): ExtractionDefinition {
  const out: ExtractionDefinition = {
    name: x.name.trim(),
    sourceField: x.sourceField.trim(),
    type: x.type,
    expression: x.expression,
    valueType: x.valueType ?? 'STRING',
    sensitive: x.sensitive ?? false,
  };
  if (x.label && x.label.trim()) {
    out.label = x.label.trim();
  }
  if (x.group && x.group.trim()) {
    out.group = x.group.trim();
  }
  return out;
}

function cleanCondition(c: RuleCondition): RuleCondition {
  return { field: c.field.trim(), matcher: c.matcher, value: c.value, ignoreCase: c.ignoreCase ?? false };
}

/** The rule body sent to the server: server-managed timestamps dropped, empty optional strings omitted. */
export function toWritableRule(rule: ClassificationRule, keepId = true): ClassificationRule {
  const out: ClassificationRule = {
    name: rule.name.trim(),
    description: rule.description ?? '',
    tags: [...(rule.tags ?? [])],
    enabled: rule.enabled ?? true,
    priority: rule.priority ?? 100,
    matchMode: rule.matchMode ?? 'ALL',
    conditions: (rule.conditions ?? []).map(cleanCondition),
    extractions: (rule.extractions ?? []).map(cleanExtraction),
  };
  if (keepId && rule.id) {
    out.id = rule.id;
  }
  return out;
}

/** Errors whose path is `root` itself or indexes into it (`conditions[0].value`, `conditions.0.value`, `conditions/0`). */
export function errorsAt(errors: RuleValidationError[], root: string, index?: number): RuleValidationError[] {
  const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern =
    index == null
      ? new RegExp(`^/?${escaped}($|[.[/])`)
      : new RegExp(`^/?${escaped}(\\[${index}\\]|[./]${index})($|[.[/])`);
  return errors.filter((e) => pattern.test(e.path));
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.problem.detail ?? error.problem.title ?? error.message;
  }
  return error instanceof Error ? error.message : fallback;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${bytes} bytes`;
}

/** Reads a user-selected file as text via FileReader (held only in component state). */
export function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsText(file);
  });
}
