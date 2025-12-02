declare module 'bun:test' {
  type TestHandler = () => void | Promise<void>;

  export function describe(name: string, handler: TestHandler): void;
  export function it(name: string, handler: TestHandler): void;
  export function expect<T>(value: T): {
    toContain(expected: string): void;
    not: {
      toContain(expected: string): void;
    };
  };
}
