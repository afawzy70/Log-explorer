/**
 * A thin, mockable wrapper around `navigator.clipboard.writeText` - kept
 * as its own module (rather than calling the browser API directly from
 * component code) so tests can substitute it with `vi.mock` instead of
 * fighting jsdom's own real `Clipboard` implementation, which cannot be
 * shadowed by redefining `navigator.clipboard` from a test.
 */
export async function copyToClipboard(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}
