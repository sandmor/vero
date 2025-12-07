import { beforeAll, mock } from 'bun:test';
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
const windowWithAny = globalThis.window as any;

if (!('matchMedia' in windowWithAny)) {
  windowWithAny.matchMedia = (query: string) => ({
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

if (!('ResizeObserver' in windowWithAny)) {
  (windowWithAny as any).ResizeObserver = ResizeObserverStub;
  (globalThis as any).ResizeObserver = ResizeObserverStub;
}

if (typeof getComputedStyle === 'undefined') {
  (globalThis as any).getComputedStyle =
    windowWithAny.getComputedStyle.bind(windowWithAny);
}

class StorageEventPolyfill extends (windowWithAny.Event as typeof Event) {
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
(windowWithAny as any).StorageEvent = StorageEventPolyfill;
(globalThis as any).StorageEvent = StorageEventPolyfill;

if (!(globalThis as any).DocumentFragment) {
  (globalThis as any).DocumentFragment = windowWithAny.DocumentFragment;
}

class MutationObserverStub {
  constructor(_callback: MutationCallback) {}
  observe() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
(windowWithAny as any).MutationObserver = MutationObserverStub;
(globalThis as any).MutationObserver = MutationObserverStub;

// Mock Clerk authentication
mock.module('@clerk/nextjs', () => ({
  auth: () => ({
    userId: 'test-user-id',
  }),
  currentUser: () => ({
    id: 'test-user-id',
    emailAddresses: [{ emailAddress: 'test@example.com' }],
  }),
}));

// Mock environment variables
mock.module('@/lib/constants', () => ({
  isProductionEnvironment: false,
  isDevelopmentEnvironment: false,
  isTestEnvironment: true,
  guestRegex: /^guest-\d+$/,
  adminEmail: 'admin@example.com',
  adminUserId: 'admin-user-id',
}));

const chatActionsMock = {
  saveChatModelAsCookie: () => {},
  saveReasoningEffortAsCookie: () => {},
  updateChatVisibility: () => {},
  updateBranchSelection: () => {},
  deleteTrailingMessages: () => {},
  generateTitleFromChatHistory: () => {},
  forkChatAction: () => {},
  branchMessageAction: () => {},
  getMessageTreeAction: async () => ({
    tree: [],
    nodes: [],
    branch: [],
    rootMessageIndex: null,
  }),
};

mock.module('@/app/actions/chat', () => chatActionsMock);
mock.module('next/navigation', () => import('./mocks/next-navigation'));
mock.module('next/navigation.js', () => import('./mocks/next-navigation'));
mock.module('server-only', () => ({}));

// Global test setup
beforeAll(() => {
  // Add any global setup here
});
