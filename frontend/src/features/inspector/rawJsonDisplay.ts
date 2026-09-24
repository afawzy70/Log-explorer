/**
 * Owner report — "see the real container JSON" (Inspector). `event.rawJson`
 * arrives from the backend as a compact string (already masked
 * server-side, see `MaskingService#maskRawJson`'s own javadoc) - this pure
 * function is the one place the Inspector decides how to *display* it.
 *
 * <p>Pretty-prints valid JSON (the common case: a well-formed source line)
 * for readability, matching the existing "Canonical Event JSON"
 * disclosure's own `JSON.stringify(event, null, 2)` formatting. Falls back
 * to the raw string verbatim when it isn't parseable JSON at all — the
 * malformed-line case, where the masked text is free text, not JSON, and
 * forcing it through `JSON.parse` would only ever throw.
 */
export function formatMaskedRawJson(rawJson: string): string {
  try {
    return JSON.stringify(JSON.parse(rawJson), null, 2);
  } catch {
    return rawJson;
  }
}
