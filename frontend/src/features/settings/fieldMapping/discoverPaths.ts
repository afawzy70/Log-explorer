/**
 * Discovers available JSON field paths from a bounded set of real
 * Original Source JSON samples (mission "Configurable Log Field Mapping +
 * Original JSON Sampling" §7: "Discover JSON paths... Support nested JSON
 * paths. Do not flatten in a way that loses path identity. Arrays/objects
 * must be represented truthfully.").
 *
 * <p>Pure, deterministic, synchronous — no `eval`, no dynamic code
 * execution of any kind (matches the backend's own {@code
 * core.mapping.JsonPath} "no eval, no scripting" discipline). A malformed
 * (non-JSON, or JSON that isn't an object) sample is skipped, never
 * throws.
 *
 * <p><b>Path syntax</b> — must exactly match {@code
 * core.mapping.JsonPath.parse}'s grammar (backend/src/main/java/com/logexplorer/core/mapping/JsonPath.java),
 * since a displayed path here is meant to be typed/pasted directly into a
 * candidate-path field and parsed server-side with that identical
 * grammar:
 * <ul>
 *   <li>Plain segments join with {@code .} — {@code mdc.cif}.</li>
 *   <li>A key that itself contains a literal {@code .} is rendered as a
 *       bracketed, double-quoted segment — {@code mdc["event.correlationId"]}
 *       — never silently treated as a nested path.</li>
 * </ul>
 */

export interface DiscoveredPath {
  /** Display/copyable path string — see the module doc comment for the exact grammar. */
  path: string;
  /** A short, human-readable preview of one example value seen at this path. */
  valuePreview: string;
  /** The resolved value's JSON shape at this path (first sample it was seen in). */
  valueKind: 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object';
}

const MAX_PREVIEW_LENGTH = 80;

export function discoverPaths(rawSamples: string[]): DiscoveredPath[] {
  const byPath = new Map<string, DiscoveredPath>();

  for (const raw of rawSamples) {
    const parsed = tryParseObject(raw);
    if (parsed === null) {
      continue; // malformed sample - skipped, never thrown
    }
    walk(parsed, [], byPath);
  }

  return Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path));
}

function tryParseObject(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function walk(node: Record<string, unknown>, segments: string[], byPath: Map<string, DiscoveredPath>): void {
  for (const [key, value] of Object.entries(node)) {
    const nextSegments = [...segments, key];
    const path = formatPath(nextSegments);
    const kind = valueKindOf(value);

    if (!byPath.has(path)) {
      byPath.set(path, { path, valuePreview: previewOf(value, kind), valueKind: kind });
    }

    // Recurse into plain nested objects (not arrays, not null) so a
    // deeper leaf like context.customer.cif is still discoverable - the
    // object path itself is ALSO recorded above (truthfully, as an
    // 'object'-kind entry) rather than skipped, since a canonical field
    // could in principle be mapped to it (the backend's own validation
    // reports a structuredValueWarning in that case, it does not forbid it).
    if (kind === 'object') {
      walk(value as Record<string, unknown>, nextSegments, byPath);
    }
  }
}

/** A key containing a literal `.` gets bracket-quoted; every other segment joins with `.` — see module doc comment. */
function formatPath(segments: string[]): string {
  return segments
    .map((segment, index) => {
      const needsBrackets = segment.includes('.');
      if (needsBrackets) {
        const literal = `["${segment}"]`;
        return index === 0 ? literal : literal;
      }
      return segment;
    })
    .reduce((acc, part, index) => {
      if (index === 0) {
        return part;
      }
      // A bracketed segment attaches directly (mdc["x.y"]); a plain
      // segment needs a preceding dot (mdc.cif).
      return part.startsWith('[') ? acc + part : `${acc}.${part}`;
    }, '');
}

function valueKindOf(value: unknown): DiscoveredPath['valueKind'] {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  if (typeof value === 'object') {
    return 'object';
  }
  if (typeof value === 'number') {
    return 'number';
  }
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  return 'string';
}

function previewOf(value: unknown, kind: DiscoveredPath['valueKind']): string {
  if (kind === 'array') {
    const length = Array.isArray(value) ? value.length : 0;
    return `[array, ${length} item${length === 1 ? '' : 's'}]`;
  }
  if (kind === 'object') {
    const keyCount = value && typeof value === 'object' ? Object.keys(value as object).length : 0;
    return `{object, ${keyCount} field${keyCount === 1 ? '' : 's'}}`;
  }
  if (kind === 'null') {
    return 'null';
  }
  const stringValue = String(value);
  return stringValue.length > MAX_PREVIEW_LENGTH ? `${stringValue.slice(0, MAX_PREVIEW_LENGTH)}…` : stringValue;
}
