declare module 'jest-axe' {
  export function axe(html: Element | string): Promise<{ violations: unknown[] }>;
  export const toHaveNoViolations: {
    toHaveNoViolations(received: unknown): { pass: boolean; message(): string };
  };
}
