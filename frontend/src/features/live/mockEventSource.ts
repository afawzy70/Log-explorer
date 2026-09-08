/**
 * A minimal, test-only stand-in for the browser's native `EventSource` -
 * jsdom does not implement it at all (verified directly: `typeof
 * window.EventSource === 'undefined'` in this project's jsdom version),
 * so `useLiveTail.ts` cannot be exercised against a real one in Vitest.
 * Mirrors exactly the surface `useLiveTail.ts` actually uses:
 * `addEventListener('log'|'status', ...)`, `onopen`, `onerror`, `close()`.
 */
export class MockEventSource {
  static instances: MockEventSource[] = [];

  readonly url: string;
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (event: MessageEvent) => void): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(handler);
    this.listeners.set(type, existing);
  }

  close(): void {
    this.closed = true;
  }

  // Test-only helpers, never called by production code.
  emitOpen(): void {
    this.onopen?.();
  }

  emitError(): void {
    this.onerror?.();
  }

  emit(type: string, data: unknown): void {
    const event = { data: JSON.stringify(data) } as MessageEvent;
    for (const handler of this.listeners.get(type) ?? []) {
      handler(event);
    }
  }

  emitRaw(type: string, rawData: string): void {
    const event = { data: rawData } as MessageEvent;
    for (const handler of this.listeners.get(type) ?? []) {
      handler(event);
    }
  }
}

export function installMockEventSource(): void {
  MockEventSource.instances = [];
  (globalThis as unknown as { EventSource: unknown }).EventSource = MockEventSource;
}

export function latestMockEventSource(): MockEventSource {
  const instance = MockEventSource.instances.at(-1);
  if (!instance) {
    throw new Error('no MockEventSource has been created yet');
  }
  return instance;
}
