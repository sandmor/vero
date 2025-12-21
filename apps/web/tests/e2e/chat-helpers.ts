import { expect, type Page } from '@playwright/test';

export type ChatModelOption = {
  id: string;
  creator: string;
  model: string;
  name: string;
  description: string;
  capabilities: {
    supportsTools: boolean;
    supportedFormats: string[];
  } | null;
};

export type ChatBootstrapResponse = {
  kind: 'new' | 'existing';
  chatId: string;
  initialChatModel: string;
  initialVisibilityType: string;
  allowedModels: ChatModelOption[];
  initialSettings: unknown;
  initialAgent: unknown;
  autoResume: boolean;
  isReadonly: boolean;
  agentId?: string;
  initialMessages?: unknown;
  initialBranchState?: {
    rootMessageIndex: number | null;
  };
  initialLastContext?: unknown;
};

export type HistoryPage = {
  chats: unknown[];
  hasMore: boolean;
};

type TestMocksState = {
  bootstrap: ChatBootstrapResponse;
  chatRequests: Array<{ body: string }>;
  actionRequests: string[];
  historyPages: HistoryPage[];
  historyRequestCount: number;
  historyResponse: HistoryPage;
  historyFetchLog: Array<{ index: number; hasMore: boolean; length: number }>;
  lastSettingsPayload: string | null;
  uploadRequests: Array<{ name: string; contentType: string }>;
};

declare global {
  interface Window {
    __testMocks?: TestMocksState;
  }
}

export const VISION_MODEL: ChatModelOption = {
  id: 'test:vision',
  creator: 'test',
  model: 'test/vision',
  name: 'Vision Model',
  description: 'Supports attachments',
  capabilities: {
    supportsTools: false,
    supportedFormats: ['text', 'image'],
  },
};

export const TEXT_MODEL: ChatModelOption = {
  id: 'test:text',
  creator: 'test',
  model: 'test/text',
  name: 'Text Model',
  description: 'Text only responses',
  capabilities: {
    supportsTools: false,
    supportedFormats: ['text'],
  },
};

export const DEFAULT_BOOTSTRAP: ChatBootstrapResponse = {
  kind: 'new',
  chatId: 'chat-e2e',
  initialChatModel: VISION_MODEL.id,
  initialVisibilityType: 'private',
  allowedModels: [VISION_MODEL, TEXT_MODEL],
  initialSettings: null,
  initialAgent: null,
  autoResume: false,
  isReadonly: false,
  initialBranchState: { rootMessageIndex: null },
};

export type ConfigureChatMocksOptions = {
  bootstrap?: Partial<ChatBootstrapResponse>;
  historyPages?: HistoryPage[];
};

export async function configureChatMocks(
  page: Page,
  options: ConfigureChatMocksOptions = {}
) {
  const { bootstrap: overrides = {}, historyPages = [] } = options;
  const allowedModels =
    overrides.allowedModels ?? DEFAULT_BOOTSTRAP.allowedModels;

  const bootstrap: ChatBootstrapResponse = {
    ...DEFAULT_BOOTSTRAP,
    ...overrides,
    allowedModels,
    initialChatModel:
      overrides.initialChatModel ??
      (allowedModels.length > 0
        ? allowedModels[0].id
        : DEFAULT_BOOTSTRAP.initialChatModel),
  };

  let finalHistoryPages = historyPages;
  if (bootstrap.kind === 'existing' && finalHistoryPages.length === 0) {
    // Auto-generate history record for existing chat bootstrap
    const record: any = {
      chatId: bootstrap.chatId,
      lastUpdatedAt: new Date().toISOString(),
      bootstrap,
      chat: {
        id: bootstrap.chatId,
        title: 'Mock Chat',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        userId: 'user-mock',
        visibility: 'private',
        agent: null,
        lastContext: null,
        settings: null,
      },
    };
    finalHistoryPages = [{ chats: [record], hasMore: false }];
  }

  if (
    bootstrap.allowedModels.length > 0 &&
    !bootstrap.allowedModels.some(
      (model) => model.id === bootstrap.initialChatModel
    )
  ) {
    bootstrap.initialChatModel = bootstrap.allowedModels[0].id;
  }

  const serializedBootstrap = JSON.parse(
    JSON.stringify(bootstrap)
  ) as ChatBootstrapResponse;

  await page.addInitScript(
    ({ bootstrap: initialBootstrap, historyPages: initialHistoryPages }) => {
      const originalFetch = window.fetch.bind(window);

      const readBody = async (body: any): Promise<string> => {
        if (!body) return '';
        if (typeof body === 'string') return body;
        if (body instanceof Blob) return await body.text();
        if (body instanceof FormData) {
          const entries: string[] = [];
          for (const [key, value] of body.entries()) {
            if (typeof value === 'string') {
              entries.push(`${key}=${value}`);
            } else if (value && typeof (value as any).name === 'string') {
              entries.push(`${key}=${(value as any).name}`);
            }
          }
          return entries.join('&');
        }
        try {
          return await new Response(body).text();
        } catch (_error) {
          console.warn('Unable to capture request body in tests');
          return '';
        }
      };

      const makeStreamResponse = () => {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            timeout = setTimeout(() => {
              controller.close();
            }, 1200);
          },
          cancel() {
            if (timeout) {
              clearTimeout(timeout);
            }
          },
        });

        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      };

      const state: TestMocksState = {
        bootstrap: initialBootstrap,
        chatRequests: [],
        actionRequests: [],
        historyPages:
          initialHistoryPages && initialHistoryPages.length
            ? initialHistoryPages
            : [{ chats: [], hasMore: false }],
        historyRequestCount: 0,
        historyResponse: { chats: [], hasMore: false },
        historyFetchLog: [],
        lastSettingsPayload: null,
        uploadRequests: [],
      };

      window.__testMocks = state;

      (window as any).fetch = async (input: any, init: any = {}) => {
        const method = (init?.method ?? 'GET').toUpperCase();
        const targetUrl =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : ((input && typeof input === 'object' && 'url' in input
                ? (input as { url?: string }).url
                : undefined) ?? window.location.origin);
        const { pathname } = new URL(targetUrl, window.location.origin);

        if (pathname === '/api/cache/sync') {
          const mocks = window.__testMocks!;
          const index = Math.min(
            mocks.historyRequestCount,
            Math.max(mocks.historyPages.length - 1, 0)
          );
          const pageResponse = mocks.historyPages[index] ?? {
            chats: [],
            hasMore: false,
          };
          mocks.historyResponse = pageResponse;
          mocks.historyRequestCount += 1;
          mocks.historyFetchLog.push({
            index,
            hasMore: !!pageResponse.hasMore,
            length: Array.isArray(pageResponse.chats)
              ? pageResponse.chats.length
              : 0,
          });
          console.info('[e2e] cache sync request', {
            index,
            count: mocks.historyRequestCount,
            hasMore: pageResponse.hasMore,
            length: Array.isArray(pageResponse.chats)
              ? pageResponse.chats.length
              : 0,
          });
          // Return cache sync response format with newChatDefaults
          const allowedModelIds = (mocks.bootstrap.allowedModels ?? []).map(
            (m: ChatModelOption) => m.id
          );
          return new Response(
            JSON.stringify({
              upserts: pageResponse.chats,
              deletions: [],
              serverTimestamp: new Date().toISOString(),
              hasMore: false,
              nextCursor: null,
              totalChats:
                Array.isArray(pageResponse.chats) && pageResponse.chats.length
                  ? pageResponse.chats.length
                  : 0,
              metadata: {
                version: 1,
                generatedAt: new Date().toISOString(),
                allowedModels: mocks.bootstrap.allowedModels ?? [],
                cacheCompletionMarker: {
                  completeFromDate: null,
                  completeToDate: null,
                  hasOlderChats: false,
                },
                newChatDefaults: {
                  defaultModelId:
                    mocks.bootstrap.initialChatModel ||
                    allowedModelIds[0] ||
                    '',
                  allowedModelIds,
                },
              },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        }

        if (pathname === '/api/chat/settings') {
          if (method === 'GET') {
            return new Response(JSON.stringify({ settings: {} }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }

          window.__testMocks!.lastSettingsPayload = await readBody(
            init.body ?? null
          );

          return new Response(JSON.stringify({ settings: {} }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (pathname === '/api/files/upload' && method === 'POST') {
          let uploadedName = 'uploaded-file.dat';
          let uploadedContentType = 'application/octet-stream';
          let uploadedUrl: string | null = null;
          const body = init.body as any;
          if (
            body &&
            typeof body === 'object' &&
            typeof body.entries === 'function'
          ) {
            for (const entry of body.entries()) {
              const value = entry?.[1];
              if (value && typeof value === 'object' && 'name' in value) {
                uploadedName = (value as any).name || uploadedName;
                uploadedContentType =
                  (value as any).type || uploadedContentType;
                if (typeof (value as any).arrayBuffer === 'function') {
                  try {
                    const arrayBuffer = await (value as File).arrayBuffer();
                    const bytes = new Uint8Array(arrayBuffer);
                    let binary = '';
                    for (let index = 0; index < bytes.length; index += 1) {
                      binary += String.fromCharCode(bytes[index]);
                    }
                    uploadedUrl = `data:${uploadedContentType};base64,${btoa(binary)}`;
                  } catch (_error) {
                    uploadedUrl = null;
                  }
                }
                break;
              }
            }
          }

          window.__testMocks!.uploadRequests.push({
            name: uploadedName,
            contentType: uploadedContentType,
          });

          return new Response(
            JSON.stringify({
              url:
                uploadedUrl ??
                `/mock-uploads/${encodeURIComponent(uploadedName)}`,
              pathname: uploadedName,
              contentType: uploadedContentType,
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        }

        if (pathname === '/api/chat' && method === 'POST') {
          const bodyText = await readBody(init.body ?? null);
          window.__testMocks!.chatRequests.push({ body: bodyText });
          console.info('[e2e] chat request recorded', {
            total: window.__testMocks!.chatRequests.length,
          });
          return makeStreamResponse();
        }

        if (pathname === '/_actions' && method === 'POST') {
          const bodyText = await readBody(init.body ?? null);
          window.__testMocks!.actionRequests.push(bodyText);
          return new Response('null', {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return originalFetch(input, init);
      };
    },
    {
      bootstrap: serializedBootstrap,
      historyPages: finalHistoryPages.length ? finalHistoryPages : undefined,
    }
  );
}

export async function openChat(
  page: Page,
  options?: ConfigureChatMocksOptions
) {
  await configureChatMocks(page, options);

  const bootstrap = options?.bootstrap;
  if (bootstrap?.kind === 'existing' && bootstrap.chatId) {
    await page.goto(`/chat/${bootstrap.chatId}`);
  } else {
    await page.goto('/chat');
  }
  await expect(page.getByTestId('multimodal-input')).toBeVisible();
}

export async function setMockChatHistory(
  page: Page,
  history: HistoryPage | HistoryPage[]
) {
  await page.evaluate((value) => {
    if (!window.__testMocks) {
      throw new Error('Test mocks not configured');
    }
    const pages = Array.isArray(value) ? value : [value];
    window.__testMocks.historyPages = pages.map((page) => ({
      chats: page.chats,
      hasMore: page.hasMore,
    }));
    window.__testMocks.historyRequestCount = 0;
    window.__testMocks.historyResponse = pages[0] ?? {
      chats: [],
      hasMore: false,
    };
    window.__testMocks.historyFetchLog = [];
  }, history as any);
}
