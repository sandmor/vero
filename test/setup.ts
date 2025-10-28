import '@testing-library/jest-dom';
import { beforeAll, vi } from 'vitest';
import { JSDOM } from 'jsdom';

// Set up JSDOM
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost:3000',
});

global.window = dom.window as any;
global.document = dom.window.document;
global.navigator = dom.window.navigator;

// Polyfill missing browser APIs used by client components during tests
const noop = () => {};
const testWindow = globalThis.window as any;

if (!('matchMedia' in testWindow)) {
  testWindow.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: noop,
    removeEventListener: noop,
    addListener: noop,
    removeListener: noop,
    dispatchEvent: () => false,
  });
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!('ResizeObserver' in testWindow)) {
  (testWindow as any).ResizeObserver = ResizeObserverStub;
  (global as any).ResizeObserver = ResizeObserverStub;
}

if (typeof getComputedStyle === 'undefined') {
  (global as any).getComputedStyle =
    testWindow.getComputedStyle.bind(testWindow);
}

class StorageEventPolyfill extends (testWindow.Event as typeof Event) {
  key: string | null;
  newValue: string | null;
  oldValue: string | null;
  storageArea: Storage | null;
  url: string;

  constructor(type: string, init: StorageEventInit = {}) {
    super(type, init);
    this.key = init.key ?? null;
    this.newValue = init.newValue ?? null;
    this.oldValue = init.oldValue ?? null;
    this.storageArea = init.storageArea ?? null;
    this.url = init.url ?? '';
  }
}
(testWindow as any).StorageEvent = StorageEventPolyfill;
(globalThis as any).StorageEvent = StorageEventPolyfill;

if (!(globalThis as any).DocumentFragment) {
  (globalThis as any).DocumentFragment = testWindow.DocumentFragment;
}

class MutationObserverStub {
  constructor(_callback: MutationCallback) {}
  observe() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
(testWindow as any).MutationObserver = MutationObserverStub;
(globalThis as any).MutationObserver = MutationObserverStub;

// Mock Clerk authentication
vi.mock('@clerk/nextjs', () => ({
  auth: () => ({
    userId: 'test-user-id',
  }),
  currentUser: () => ({
    id: 'test-user-id',
    emailAddresses: [{ emailAddress: 'test@example.com' }],
  }),
}));

// Mock environment variables
vi.mock('@/lib/constants', () => ({
  isProductionEnvironment: false,
  isDevelopmentEnvironment: false,
  isTestEnvironment: true,
  guestRegex: /^guest-\d+$/,
  adminEmail: 'admin@example.com',
  adminUserId: 'admin-user-id',
}));

const isBunRuntime = Boolean(process?.versions?.bun);

const chatActionsMock = {
  saveChatModelAsCookie: vi.fn(),
  saveReasoningEffortAsCookie: vi.fn(),
  updateChatVisibility: vi.fn(),
  deleteTrailingMessages: vi.fn(),
  generateTitleFromChatHistory: vi.fn(),
  forkChatAction: vi.fn(),
};

vi.mock('@/app/(chat)/actions', () => chatActionsMock);

if (isBunRuntime) {
  const bunTest = (await import('bun:test')) as unknown as {
    mock: {
      module: (id: string, factory: () => Promise<unknown> | unknown) => void;
    };
  };
  bunTest.mock.module(
    'next/navigation',
    () => import('./mocks/next-navigation')
  );
  bunTest.mock.module(
    'next/navigation.js',
    () => import('./mocks/next-navigation')
  );
  bunTest.mock.module('server-only', () => ({}));
} else {
  // Mock Next.js router for Vitest runs
  vi.mock('next/navigation', () => ({
    useRouter: () => ({
      push: vi.fn(),
      replace: vi.fn(),
      back: vi.fn(),
    }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/',
  }));
  // Mock server-only to prevent import errors in client components during testing
  vi.mock('server-only', () => ({}));
}

// Global test setup
beforeAll(() => {
  // Add any global setup here
});
