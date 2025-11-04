// Test stub mimicking the limited router/search params API required by client components.
export function useRouter() {
  return {
    push: jestLikeNoop,
    replace: jestLikeNoop,
    back: jestLikeNoop,
    forward: jestLikeNoop,
    prefetch: async () => {},
  };
}

export function useSearchParams() {
  return new URLSearchParams();
}

export function notFound(): never {
  throw new Error('notFound was called during a test');
}

export function redirect(): never {
  throw new Error('redirect was called during a test');
}

function jestLikeNoop() {
  // intentionally empty - stub for router methods in tests
}
