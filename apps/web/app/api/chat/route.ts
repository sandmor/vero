import { geolocation } from '@vercel/functions';
import {
  convertToModelMessages,
  createUIMessageStream,
  JsonToSseTransformStream,
  smoothStream,
  stepCountIs,
  streamText,
} from 'ai';
import type { ModelMessage } from 'ai';
import type { SharedV2ProviderOptions } from '@ai-sdk/provider';
import { unstable_cache as nextCache } from 'next/cache';
import { after } from 'next/server';
import { getAppSession } from '@/lib/auth/session';
import type { UserType } from '@/lib/auth/types';
import type { VisibilityType } from '@/components/visibility-selector';
import { getTierForUserType } from '@/lib/ai/tiers';
import type { ChatModel } from '@/lib/ai/models';
import { isModelIdAllowed } from '@/lib/ai/models';
import {
  getDefaultSystemPromptParts,
  type RequestHints,
  type SystemPromptOptions,
  systemPrompt,
} from '@/lib/ai/prompts';
import {
  agentPromptConfigIsDefault,
  buildPromptPartsFromConfig,
  getAgentPromptVariableMap,
} from '@/lib/agent-prompt';
import {
  createResumableStreamContext,
  type ResumableStreamContext,
} from 'resumable-stream';
import type { ModelCatalog } from 'tokenlens/core';
import { fetchModels } from 'tokenlens/fetch';
import { getUsage } from 'tokenlens/helpers';
import { getModelCost } from '@/lib/ai/pricing';
import {
  getLanguageModel,
  getByokLanguageModel,
  isByokModelId,
  parseByokModelId,
} from '@/lib/ai/providers';
import { getChatSettings } from '@/lib/db/chat-settings';
import { readArchive } from '@/lib/ai/tools/readArchive';
import { writeArchive } from '@/lib/ai/tools/writeArchive';
import { manageChatPins } from '@/lib/ai/tools/manageChatPins';
import { getWeather } from '@/lib/ai/tools/get-weather';
import { runCode } from '@/lib/ai/tools/run-code';
import { isProductionEnvironment } from '@/lib/constants';
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getActiveMessagesByChatId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
  updateChatLastContextById,
  saveAssistantMessage,
  getPinnedArchiveEntriesForChat,
} from '@/lib/db/queries';
import { consumeTokens } from '@/lib/rate-limit/token-bucket';
import { ChatSDKError } from '@/lib/errors';
import type { ChatMessage } from '@/lib/types';
import type { AppUsage } from '@/lib/usage';
import { convertToUIMessages, generateUUID } from '@/lib/utils';
import { generateTitleFromChatHistory } from '@/app/actions/chat';
import { updateChatTitleById } from '@/lib/db/queries';
import { ZodError } from 'zod';
import { type PostRequestBody, createPostRequestBodySchema } from './schema';
import { prisma } from '@virid/db';
import { getModelCapabilities, type ResolvedModelCapabilities } from '@/lib/ai/model-capabilities';
import { getSettings } from '@/lib/settings';
import { CHAT_TOOL_IDS, normalizeChatToolIds } from '@/lib/ai/tool-ids';
import type { ChatSettings, MessageTreeNode } from '@/lib/db/schema';
import { getUserByokConfig, resolveByokModel } from '@/lib/queries/byok';

export const maxDuration = 300;

type PromptPinnedEntry = {
  slug: string;
  entity: string;
  body: string;
};

const getCachedModelCapabilities = (modelId: string) =>
  nextCache(
    async () => getModelCapabilities(modelId),
    ['model-capabilities', modelId], // Key for cache invalidation
    { revalidate: 300 } // 5 minutes
  );

function isErrorWithMessage(error: unknown): error is { message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}

type ComparableUserContent = {
  textParts: string[];
  fileParts: Array<{
    mediaType?: string;
    name?: string;
    url?: string;
  }>;
};

function extractComparableUserContent(parts: unknown): ComparableUserContent {
  const comparable: ComparableUserContent = {
    textParts: [],
    fileParts: [],
  };

  if (!Array.isArray(parts)) {
    return comparable;
  }

  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;

    const kind = (part as Record<string, unknown>).type;
    if (kind === 'text') {
      const text = (part as Record<string, unknown>).text;
      if (typeof text === 'string') {
        comparable.textParts.push(text);
      }
      continue;
    }

    if (kind === 'file') {
      const filePart = part as Record<string, unknown>;
      comparable.fileParts.push({
        mediaType:
          typeof filePart.mediaType === 'string'
            ? filePart.mediaType
            : undefined,
        name: typeof filePart.name === 'string' ? filePart.name : undefined,
        url: typeof filePart.url === 'string' ? filePart.url : undefined,
      });
    }
  }

  return comparable;
}

function comparableUserContentEqual(
  a: ComparableUserContent,
  b: ComparableUserContent
): boolean {
  if (a.textParts.length !== b.textParts.length) return false;
  for (let index = 0; index < a.textParts.length; index += 1) {
    if (a.textParts[index] !== b.textParts[index]) {
      return false;
    }
  }

  if (a.fileParts.length !== b.fileParts.length) return false;
  for (let index = 0; index < a.fileParts.length; index += 1) {
    const left = a.fileParts[index];
    const right = b.fileParts[index];
    if (
      left.mediaType !== right.mediaType ||
      left.name !== right.name ||
      left.url !== right.url
    ) {
      return false;
    }
  }

  return true;
}

let globalStreamContext: ResumableStreamContext | null = null;

const getTokenlensCatalog = nextCache(
  async (): Promise<ModelCatalog | undefined> => {
    try {
      return await fetchModels();
    } catch (err) {
      console.warn(
        'TokenLens: catalog fetch failed, using default catalog',
        err
      );
      return; // tokenlens helpers will fall back to defaultCatalog
    }
  },
  ['tokenlens-catalog'],
  { revalidate: 60 * 60 }
);

export function getStreamContext() {
  if (!globalStreamContext) {
    try {
      globalStreamContext = createResumableStreamContext({
        waitUntil: after,
      });
    } catch (error: unknown) {
      if (isErrorWithMessage(error) && error.message.includes('REDIS_URL')) {
        console.log(
          ' > Resumable streams are disabled due to missing REDIS_URL'
        );
      } else {
        console.error(error);
      }
    }
  }

  return globalStreamContext;
}

export async function POST(request: Request) {
  const appSettingsPromise = getSettings();
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    // Use dynamic schema for validation with current settings
    const dynamicSchema = await createPostRequestBodySchema();
    requestBody = dynamicSchema.parse(json);
  } catch (error) {
    if (error instanceof ZodError) {
      const appSettings = await appSettingsPromise;
      const friendlyMessage = await formatChatValidationError(
        error,
        appSettings
      );
      const err = new ChatSDKError('bad_request:api', friendlyMessage);
      return err.toResponse();
    }
    return new ChatSDKError('bad_request:api').toResponse();
  }

  try {
    const {
      id,
      message: requestUserMessage,
      selectedChatModel,
      selectedVisibilityType,
      pinnedSlugs,
      allowedTools: rawAllowedTools,
      agentId,
      reasoningEffort,
      regenerateMessageId,
    }: {
      id: string;
      message: ChatMessage;
      selectedChatModel: ChatModel['id'];
      selectedVisibilityType: VisibilityType;
      pinnedSlugs?: string[];
      allowedTools?: string[] | null;
      agentId?: string;
      reasoningEffort?: 'low' | 'medium' | 'high';
      regenerateMessageId?: string;
    } = requestBody;

    const isRegeneration = typeof regenerateMessageId === 'string';

    const allowedTools =
      rawAllowedTools === undefined || rawAllowedTools === null
        ? undefined
        : (normalizeChatToolIds(rawAllowedTools) ?? []).slice(0, 64);

    const normalizedPinnedSlugs =
      pinnedSlugs && pinnedSlugs.length > 0
        ? Array.from(new Set(pinnedSlugs)).slice(0, 12)
        : undefined;

    const [session, chat] = await Promise.all([
      getAppSession(),
      getChatById({ id }),
    ]);

    if (!session?.user) {
      return new ChatSDKError('unauthorized:chat').toResponse();
    }
    let createdNewChat = false;

    const userType: UserType = session.user.type;
    const tierPromise = getTierForUserType(userType);

    if (chat) {
      if (chat.userId !== session.user.id) {
        return new ChatSDKError('forbidden:chat').toResponse();
      }
    } else {
      // Fast placeholder title from user text (avoid model call latency)
      const placeholder = (() => {
        try {
          const textParts = requestUserMessage.parts
            .filter((p: any) => p.type === 'text' && typeof p.text === 'string')
            .map((p: any) => p.text)
            .join(' ')
            .trim();
          if (!textParts) return 'New Chat';
          return textParts.slice(0, 60);
        } catch {
          return 'New Chat';
        }
      })();

      await saveChat({
        id,
        userId: session.user.id,
        title: placeholder,
        visibility: selectedVisibilityType,
        agentId,
      });
      createdNewChat = true;

      // Apply initial settings preset (agent base + user overrides) in one place.
      try {
        const { applyInitialSettingsPreset } =
          await import('@/lib/db/chat-settings');
        let base: any | null = null;
        if (agentId) {
          try {
            const agent = await prisma.agent.findFirst({
              where: { id: agentId, userId: session.user.id },
            });
            base = agent?.settings || null;
          } catch (e) {
            console.warn('Agent fetch failed during initialization', e);
          }
        }
        await applyInitialSettingsPreset({
          chatId: id,
          base,
          overrides: {
            allowedTools,
            // pinnedSlugs are applied to settings cache only; join creation handled below asynchronously.
            pinnedSlugs: normalizedPinnedSlugs,
            reasoningEffort,
            modelId: selectedChatModel,
          },
          userId: session.user.id,
        });
      } catch (e) {
        console.warn('Failed to apply initial settings preset', e);
      }

      // Fire-and-forget real title generation (no await)
      (async () => {
        try {
          const realTitle = await generateTitleFromChatHistory({
            messages: [requestUserMessage],
          });
          if (realTitle && realTitle !== placeholder) {
            await updateChatTitleById({
              chatId: id,
              title: realTitle,
              userId: session.user.id,
            });
          }
        } catch (e) {
          console.warn('Deferred title generation failed', e);
        }
      })();

      // Initial pinning executes in background; we don't block stream start.
      if (normalizedPinnedSlugs && normalizedPinnedSlugs.length) {
        (async () => {
          const unique = normalizedPinnedSlugs;
          try {
            const { pinArchiveEntryToChat } = await import('@/lib/db/queries');
            await Promise.all(
              unique.map(async (slug) => {
                try {
                  await pinArchiveEntryToChat({
                    userId: session.user.id,
                    chatId: id,
                    slug,
                  });
                } catch (e) {
                  console.warn('Initial pin failed', {
                    chatId: id,
                    slug,
                    error: e,
                  });
                }
              })
            );
          } catch (e) {
            console.warn('Pin helper import failed', e);
          }
        })();
      }
    }

    const {
      modelIds: tierModelIds,
      bucketCapacity,
      bucketRefillAmount,
      bucketRefillIntervalSeconds,
    } = await tierPromise;

    // Check if this is a BYOK model request
    const isUserByokModel = isByokModelId(selectedChatModel);
    const parsedByokModel = isUserByokModel ? parseByokModelId(selectedChatModel) : null;

    // For BYOK models, resolve credentials; for platform models, use regular flow
    let byokResolution: Awaited<ReturnType<typeof resolveByokModel>> = null;
    let shouldUseByokKey = false;

    if (isUserByokModel && parsedByokModel) {
      byokResolution = await resolveByokModel(session.user.id, parsedByokModel);
      if (!byokResolution) {
        return new ChatSDKError(
          'forbidden:model',
          'BYOK model not configured or missing credentials'
        ).toResponse();
      }
      shouldUseByokKey = true;
    }

    // Token bucket consumption: cost = 1 user message per invocation
    try {
      await consumeTokens({
        userId: session.user.id,
        cost: 1,
        config: {
          capacity: bucketCapacity,
          refillAmount: bucketRefillAmount,
          refillIntervalSeconds: bucketRefillIntervalSeconds,
        },
      });
    } catch (e) {
      if (
        e instanceof ChatSDKError &&
        e.type === 'rate_limit' &&
        e.surface === 'chat'
      ) {
        return e.toResponse();
      }
      throw e;
    }

    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      longitude,
      latitude,
      city,
      country,
    };

    let regenerationContextPromise: Promise<RegenerationContext> | null = null;
    if (isRegeneration) {
      regenerationContextPromise = loadRegenerationContext({
        chatId: id,
        targetMessageId: regenerateMessageId!,
      });
    }

    const messagesPromise: Promise<MessageTreeNode[]> =
      regenerationContextPromise
        ? regenerationContextPromise.then((context) => context.branch)
        : loadActiveMessagesOrEmpty(id);
    const pinnedEntriesPromise = resolvePinnedPromptEntries({
      chatId: id,
      userId: session.user.id,
      providedSlugs: normalizedPinnedSlugs,
      createdNewChat,
    });
    const settingsPromise: Promise<ChatSettings> = getChatSettings(id).catch(
      (error) => {
        console.warn('Failed to load chat settings for prompt preparation', {
          chatId: id,
          error,
        });
        return {};
      }
    );

    // Resolve capabilities - for BYOK models, use the resolution info; for platform models, query DB
    let modelCapabilities: ResolvedModelCapabilities | { supportsTools: boolean; provider: string; pricing: null } | null;

    if (isUserByokModel && byokResolution) {
      // BYOK model - use resolution info for capabilities
      modelCapabilities = {
        supportsTools: byokResolution.supportsTools,
        provider: parsedByokModel!.sourceType === 'platform'
          ? parsedByokModel!.providerId
          : 'custom',
        pricing: null,
      } as any;
    } else {
      modelCapabilities = await getCachedModelCapabilities(selectedChatModel)();

      if (!modelCapabilities) {
        throw new ChatSDKError(
          'bad_request:model',
          `Model capabilities not found for ${selectedChatModel}`
        );
      }

      // For non-BYOK models, check tier access
      if (!isModelIdAllowed(selectedChatModel, tierModelIds)) {
        return new ChatSDKError(
          userType === 'guest' ? 'forbidden:model' : 'forbidden:model'
        ).toResponse();
      }
    }

    // Create model promise based on whether it's BYOK or platform
    const modelPromise = shouldUseByokKey && parsedByokModel && byokResolution
      ? Promise.resolve(getByokLanguageModel(parsedByokModel, byokResolution))
      : getLanguageModel(selectedChatModel);

    let regenerationParentMessageId: string | null = null;

    const effectiveUserMessagePromise: Promise<ChatMessage> =
      regenerationContextPromise
        ? regenerationContextPromise.then((context) => {
          const [userMessage] = convertToUIMessages([context.parent]);
          if (!userMessage) {
            throw new ChatSDKError(
              'bad_request:chat',
              'Failed to resolve user message for regeneration'
            );
          }
          regenerationParentMessageId = userMessage.id;
          return userMessage;
        })
        : Promise.resolve(requestUserMessage);

    // Regeneration replays an existing user turn; avoid duplicating it in persistence.
    let finalMergedUsage: AppUsage | undefined;

    const streamContext = getStreamContext();
    const streamId = streamContext ? generateUUID() : undefined;

    const stream = createUIMessageStream({
      execute: async ({ writer: dataStream }) => {
        // Immediately send init event to flush headers early
        dataStream.write({
          type: 'data-init',
          data: { chatId: id, createdNewChat, modelId: selectedChatModel },
        });
        // Kick off context gathering in parallel while we prepare persistence.
        const streamIdPromise =
          streamId && streamContext
            ? createStreamId({ streamId, chatId: id }).catch((e) =>
              console.warn('Failed to persist stream id (non-fatal)', e)
            )
            : Promise.resolve<void>(undefined);

        const [
          messagesFromDb,
          model,
          pinnedForPrompt,
          settings,
          _unused_capabilities, // already resolved
          appSettings,
          effectiveUserMessage,
          userPreferences,
        ] = await Promise.all([
          messagesPromise,
          modelPromise,
          pinnedEntriesPromise,
          settingsPromise,
          Promise.resolve(modelCapabilities),
          appSettingsPromise,
          effectiveUserMessagePromise,
          // Load user preferences
          prisma.user
            .findUnique({
              where: { id: session.user.id },
              select: { preferences: true },
            })
            .then((result) => {
              const prefs = result?.preferences;
              if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) {
                return null;
              }
              return prefs as Record<string, unknown>;
            })
            .catch(() => null),
        ]);

        const dbUiMessages = convertToUIMessages(messagesFromDb);
        const lastPersistedDbMessage = messagesFromDb.at(-1);
        const comparablePersistedContent = extractComparableUserContent(
          lastPersistedDbMessage?.parts
        );
        const comparableIncomingContent = extractComparableUserContent(
          effectiveUserMessage.parts
        );

        const duplicateUserTailExists =
          !isRegeneration &&
          Boolean(chat?.forkedFromMessageId) &&
          lastPersistedDbMessage?.role === 'user' &&
          effectiveUserMessage.role === 'user' &&
          comparableUserContentEqual(
            comparablePersistedContent,
            comparableIncomingContent
          );

        const skipUserPersistence = duplicateUserTailExists || isRegeneration;

        const persistUserMessagePromise = skipUserPersistence
          ? Promise.resolve()
          : saveMessages({
            messages: [
              {
                chatId: id,
                id: effectiveUserMessage.id,
                role: 'user',
                parts: effectiveUserMessage.parts,
                attachments: [],
                createdAt: new Date(),
                parentId: lastPersistedDbMessage?.id,
              },
            ],
          }).catch((e) => {
            console.warn('Failed to persist user message (non-fatal)', e);
          });

        const uiMessages = skipUserPersistence
          ? dbUiMessages
          : [...dbUiMessages, effectiveUserMessage];
        const modelMessages = convertToModelMessages(uiMessages);

        const modelSupportsTools = modelCapabilities?.supportsTools ?? true; // Default to true if not found

        // If chat just created and we received a provisional allowedTools list, prefer it over settings
        const effectiveAllowedTools =
          createdNewChat && allowedTools !== undefined
            ? allowedTools // could be [] meaning no tools
            : settings.tools?.allow;

        // Determine reasoning effort (prefer provided value, then settings, then default medium)
        const effectiveReasoningEffort =
          reasoningEffort ?? settings.reasoningEffort ?? 'medium';

        // Build provider-specific options for reasoning effort
        const [provider] = selectedChatModel.split(':');
        const providerOptions: SharedV2ProviderOptions = {};

        if (provider === 'openai') {
          // OpenAI uses reasoningEffort: 'minimal' | 'low' | 'medium' | 'high'
          providerOptions.openai = {
            reasoningEffort: effectiveReasoningEffort,
            reasoningSummary: 'detailed',
          };
        } else if (provider === 'google') {
          // Google uses thinkingConfig with thinkingBudget (number of tokens)
          // Map effort levels to token budgets
          const budgetMap: Record<'low' | 'medium' | 'high', number> = {
            low: 2048,
            medium: 4096,
            high: 8192,
          };
          const thinkingBudget = budgetMap[effectiveReasoningEffort];
          providerOptions.google = {
            thinkingConfig: {
              thinkingBudget,
              includeThoughts: true,
            },
          };
        } else if (provider === 'openrouter') {
          // OpenRouter uses reasoning.effort: 'low' | 'medium' | 'high'
          providerOptions.openrouter = {
            reasoning: {
              effort: effectiveReasoningEffort,
              enabled: true,
              exclude: false,
            },
          };
        }

        const allToolIds = CHAT_TOOL_IDS;

        const allToolIdsSet = new Set<string>(allToolIds);

        // If model doesn't support tools, force empty tool list
        const normalizedAllowedTools = normalizeChatToolIds(
          effectiveAllowedTools
        );

        const allowedToolIds = !modelSupportsTools
          ? []
          : normalizedAllowedTools === undefined
            ? [...allToolIds]
            : normalizedAllowedTools.filter((toolId) =>
              allToolIdsSet.has(toolId)
            );

        const basePromptParts = getDefaultSystemPromptParts();
        const promptResolution = buildPromptPartsFromConfig(
          settings.prompt,
          basePromptParts
        );
        // Convert user preferences to prompt variables
        const userPrefVariables: Record<string, string> = {};
        if (userPreferences) {
          const prefs = userPreferences as any;
          if (prefs.name) userPrefVariables.userName = String(prefs.name);
          if (prefs.occupation)
            userPrefVariables.userOccupation = String(prefs.occupation);
          if (prefs.customInstructions)
            userPrefVariables.userCustomInstructions = String(
              prefs.customInstructions
            );
        }

        const promptOptions: SystemPromptOptions = {
          requestHints,
          pinnedEntries: pinnedForPrompt,
          allowedTools: allowedToolIds,
          variables: {
            ...getAgentPromptVariableMap(promptResolution.normalized),
            ...userPrefVariables,
          },
        };

        if (!agentPromptConfigIsDefault(promptResolution.normalized)) {
          promptOptions.parts = promptResolution.parts;
          promptOptions.joiner = promptResolution.joiner;
        }

        const promptComposition = systemPrompt(promptOptions);
        const composedSystemPrompt = promptComposition.system;

        let mergedModelMessages: ModelMessage[] = [...modelMessages];

        if (promptComposition.messages.length > 0) {
          const baseMessageCount = modelMessages.length;
          const insertsByIndex = new Map<number, ModelMessage[]>();
          const appendedMessages: ModelMessage[] = [];

          for (const message of promptComposition.messages) {
            const normalizedDepth =
              typeof message.depth === 'number' &&
                Number.isFinite(message.depth)
                ? Math.max(0, Math.floor(message.depth))
                : 0;

            const modelMessage: ModelMessage = {
              role: message.role,
              content: message.content,
            };

            if (normalizedDepth === 0) {
              appendedMessages.push(modelMessage);
              continue;
            }

            const targetIndex = Math.max(0, baseMessageCount - normalizedDepth);
            const bucket = insertsByIndex.get(targetIndex);
            if (bucket) {
              bucket.push(modelMessage);
            } else {
              insertsByIndex.set(targetIndex, [modelMessage]);
            }
          }

          const merged: ModelMessage[] = [];

          if (baseMessageCount === 0) {
            const bucket = insertsByIndex.get(0);
            if (bucket) {
              merged.push(...bucket);
            }
          } else {
            for (let index = 0; index < baseMessageCount; index += 1) {
              const bucket = insertsByIndex.get(index);
              if (bucket) {
                merged.push(...bucket);
              }
              merged.push(modelMessages[index]);
            }
          }

          if (appendedMessages.length > 0) {
            merged.push(...appendedMessages);
          }

          mergedModelMessages = merged;
        }

        const activeTools: Record<string, any> = {};

        if (allowedToolIds.includes('getWeather')) {
          activeTools.getWeather = getWeather;
        }
        if (allowedToolIds.includes('runCode')) {
          activeTools.runCode = runCode({
            requestHints,
          });
        }

        if (allowedToolIds.includes('readArchive')) {
          activeTools.readArchive = readArchive({ session });
        }
        if (allowedToolIds.includes('writeArchive')) {
          activeTools.writeArchive = writeArchive({ session });
        }
        if (allowedToolIds.includes('manageChatPins')) {
          activeTools.manageChatPins = manageChatPins({
            session,
            chatId: id,
          });
        }

        // Determine effective maxOutputTokens:
        // 1. For BYOK models: use byokResolution.maxOutputTokens if set
        // 2. For platform models: use modelCapabilities.maxOutputTokens if set
        // 3. Fall back to global appSettings.maxOutputTokens
        let effectiveMaxOutputTokens: number | undefined;
        if (shouldUseByokKey && byokResolution?.maxOutputTokens) {
          effectiveMaxOutputTokens = byokResolution.maxOutputTokens;
        } else if (!shouldUseByokKey && modelCapabilities && 'maxOutputTokens' in modelCapabilities && modelCapabilities.maxOutputTokens) {
          effectiveMaxOutputTokens = modelCapabilities.maxOutputTokens as number;
        } else {
          effectiveMaxOutputTokens = appSettings.maxOutputTokens;
        }

        const result = streamText({
          model,
          system: composedSystemPrompt,
          messages: mergedModelMessages,
          stopWhen: stepCountIs(20),
          experimental_activeTools: allowedToolIds,
          experimental_transform: smoothStream({ chunking: 'word' }),
          tools: activeTools,
          maxOutputTokens: effectiveMaxOutputTokens,
          ...(Object.keys(providerOptions).length > 0 && { providerOptions }),
          experimental_telemetry: {
            isEnabled: isProductionEnvironment,
            functionId: 'stream-text',
          },
          abortSignal: request.signal,
          onFinish: async ({ usage }) => {
            try {
              const providers = await getTokenlensCatalog();
              if (!selectedChatModel) {
                finalMergedUsage = usage;
                dataStream.write({
                  type: 'data-usage',
                  data: finalMergedUsage,
                });
                return;
              }

              // Get cost from database pricing
              const dbCost = await getModelCost(selectedChatModel, usage);

              // Try to get usage summary from tokenlens for context window info
              let summary = {};
              if (providers) {
                try {
                  summary = getUsage({
                    modelId: selectedChatModel,
                    usage,
                    providers,
                  });
                } catch (err) {
                  console.warn('TokenLens summary failed', err);
                }
              }

              finalMergedUsage = {
                ...usage,
                ...summary,
                modelId: selectedChatModel,
                costUSD: dbCost || undefined,
              } as AppUsage;
              dataStream.write({ type: 'data-usage', data: finalMergedUsage });
            } catch (err) {
              console.warn('Usage enrichment failed', err);
              finalMergedUsage = usage;
              dataStream.write({ type: 'data-usage', data: finalMergedUsage });
            }
          },
        });

        // Ensure persistence tasks complete, but don't block model start
        Promise.all([persistUserMessagePromise, streamIdPromise]).catch(() => {
          /* already logged individually */
        });

        result.consumeStream();

        dataStream.merge(
          result.toUIMessageStream({
            sendReasoning: true,
            messageMetadata: ({ }) => {
              return {
                model: selectedChatModel,
              };
            },
          })
        );
      },
      generateId: generateUUID,
      onFinish: async ({ messages }) => {
        // messages includes the newly streamed assistant response as the last element
        const assistantMessage = messages.findLast(
          (m) => m.role === 'assistant'
        );
        if (assistantMessage) {
          const assistantIndex = messages.findLastIndex(
            (m) => m.role === 'assistant'
          );
          const parentCandidate =
            assistantIndex > 0 ? messages[assistantIndex - 1] : undefined;
          const parentId =
            regenerationParentMessageId ??
            (parentCandidate && typeof parentCandidate.id === 'string'
              ? parentCandidate.id
              : undefined);
          await saveAssistantMessage({
            id: assistantMessage.id,
            chatId: id,
            parts: assistantMessage.parts,
            attachments: [],
            model: selectedChatModel,
            parentId,
            // When regenerating, update parent's selection to point to the new message
            selectNewMessage: isRegeneration,
          });
        }

        if (finalMergedUsage) {
          try {
            const capabilities = modelCapabilities;
            const pricing = capabilities?.pricing;

            const inputTokens = finalMergedUsage.inputTokens ?? 0;
            const outputTokens = finalMergedUsage.outputTokens ?? 0;
            const reasoningTokens = finalMergedUsage.reasoningTokens ?? 0;
            const cachedInputTokens = finalMergedUsage.cachedInputTokens ?? 0;

            const inputP = pricing?.prompt ? Math.round(pricing.prompt * 1_000_000) : 0;
            const outputP = pricing?.completion
              ? Math.round(pricing.completion * 1_000_000)
              : 0;
            const reasoningP = pricing?.reasoning
              ? Math.round(pricing.reasoning * 1_000_000)
              : 0;
            const cachedP = pricing?.cacheRead
              ? Math.round(pricing.cacheRead * 1_000_000)
              : 0;

            const computedMicros =
              inputTokens * inputP +
              outputTokens * outputP +
              reasoningTokens * reasoningP +
              cachedInputTokens * cachedP;

            const totalMicros = finalMergedUsage.costUSD?.totalUSD
              ? Math.round(finalMergedUsage.costUSD.totalUSD * 1_000_000)
              : 0;

            const extrasMicros = Math.max(0, totalMicros - computedMicros);

            await Promise.all([
              updateChatLastContextById({
                chatId: id,
                context: finalMergedUsage,
              }),
              prisma.tokenUsage.create({
                data: {
                  userId: session.user.id,
                  model: selectedChatModel,
                  byok: shouldUseByokKey,
                  inputTokens,
                  cachedInputTokens,
                  reasoningTokens,
                  outputTokens,
                  inputMTokenPriceMicros: inputP || null,
                  outputMTokenPriceMicros: outputP || null,
                  reasoningMTokenPriceMicros: reasoningP || null,
                  cachedInputMTokenPriceMicros: cachedP || null,
                  extrasCostMicros: extrasMicros || null,
                  totalCostMicros: totalMicros || null,
                },
              }),
            ]);
          } catch (err) {
            console.warn('Unable to persist usage data', id, err);
          }
        }
      },
      onError: () => {
        return 'Oops, an error occurred!';
      },
    });

    const sseHeaders: Record<string, string> = {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    };

    if (streamContext && streamId) {
      try {
        const resumable = await streamContext.resumableStream(streamId, () =>
          stream.pipeThrough(new JsonToSseTransformStream())
        );

        if (resumable) {
          return new Response(resumable, { headers: sseHeaders });
        }
      } catch (error) {
        console.warn('Resumable stream fallback triggered', {
          chatId: id,
          streamId,
          error,
        });
      }
    }

    return new Response(stream.pipeThrough(new JsonToSseTransformStream()), {
      headers: sseHeaders,
    });
  } catch (error) {
    const vercelId = request.headers.get('x-vercel-id');

    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    console.error('Unhandled error in chat API:', error, { vercelId });
    return new ChatSDKError('offline:chat').toResponse();
  }
}

async function loadActiveMessagesOrEmpty(chatId: string) {
  try {
    return await getActiveMessagesByChatId({ id: chatId });
  } catch (error) {
    console.warn('Failed to load messages, proceeding with only user message', {
      chatId,
      error,
    });
    return [];
  }
}

type RegenerationContext = {
  branch: MessageTreeNode[];
  parent: MessageTreeNode;
  target: MessageTreeNode;
};

async function loadRegenerationContext({
  chatId,
  targetMessageId,
}: {
  chatId: string;
  targetMessageId: string;
}): Promise<RegenerationContext> {
  const messageTree = await getMessagesByChatId({ id: chatId });
  const nodesById = new Map(messageTree.nodes.map((node) => [node.id, node]));
  const target = nodesById.get(targetMessageId);

  if (!target) {
    throw new ChatSDKError(
      'not_found:chat',
      'Message not found for regeneration'
    );
  }

  if (target.role !== 'assistant') {
    throw new ChatSDKError(
      'bad_request:chat',
      'Only assistant messages can be regenerated'
    );
  }

  const parentPath = target.parentPath;
  if (!parentPath) {
    throw new ChatSDKError(
      'bad_request:chat',
      'Target message has no parent to regenerate from'
    );
  }

  const nodesByPath = new Map(
    messageTree.nodes.map((node) => [node.pathText, node])
  );
  const parent = nodesByPath.get(parentPath);

  if (!parent) {
    throw new ChatSDKError(
      'bad_request:chat',
      'Parent message missing for regeneration'
    );
  }

  if (parent.role !== 'user') {
    throw new ChatSDKError(
      'bad_request:chat',
      'Regeneration requires a user message parent'
    );
  }

  const branch: MessageTreeNode[] = [];
  let cursor: MessageTreeNode | undefined = parent;

  while (cursor) {
    branch.push(cursor);
    if (!cursor.parentPath) {
      break;
    }
    cursor = nodesByPath.get(cursor.parentPath);
  }

  branch.reverse();

  return { branch, parent, target };
}

async function resolvePinnedPromptEntries({
  chatId,
  userId,
  providedSlugs,
  createdNewChat,
}: {
  chatId: string;
  userId: string;
  providedSlugs?: string[];
  createdNewChat: boolean;
}): Promise<PromptPinnedEntry[] | undefined> {
  const sanitizedSlugs = providedSlugs
    ? Array.from(new Set(providedSlugs)).slice(0, 12)
    : [];

  if (createdNewChat) {
    return sanitizedSlugs.length
      ? sanitizedSlugs.map((slug) => ({ slug, entity: 'archive', body: '' }))
      : undefined;
  }

  try {
    const pinnedEntries = await getPinnedArchiveEntriesForChat({
      userId,
      chatId,
    });

    if (!pinnedEntries.length && !sanitizedSlugs.length) {
      return undefined;
    }

    const normalizedPinned = pinnedEntries.map((entry) => ({
      slug: entry.slug,
      entity: entry.entity,
      body: entry.body ?? '',
    }));

    if (!sanitizedSlugs.length) {
      return normalizedPinned.length ? normalizedPinned : undefined;
    }

    const existingSlugSet = new Set(
      normalizedPinned.map((entry) => entry.slug)
    );
    const supplemental = sanitizedSlugs
      .filter((slug) => !existingSlugSet.has(slug))
      .map<PromptPinnedEntry>((slug) => ({
        slug,
        entity: 'archive',
        body: '',
      }));

    const merged = [...normalizedPinned, ...supplemental];
    return merged.length ? merged : undefined;
  } catch (error) {
    console.warn('Failed to resolve pinned entries for prompt', {
      chatId,
      error,
    });

    return sanitizedSlugs.length
      ? sanitizedSlugs.map((slug) => ({ slug, entity: 'archive', body: '' }))
      : undefined;
  }
}

async function formatChatValidationError(
  error: ZodError,
  appSettings: Awaited<ReturnType<typeof getSettings>>
): Promise<string> {
  const issue = error.issues[0];
  if (!issue) {
    return 'The chat request is missing required fields. Please try again.';
  }

  const path = issue.path.join('.') || 'request';

  if (
    issue.code === 'too_big' &&
    typeof issue.maximum === 'number' &&
    issue.path.includes('text')
  ) {
    const { maxMessageLength: maxLength } = appSettings;
    if (issue.maximum === maxLength) {
      return `Your message is too long. Please shorten it to ${maxLength.toLocaleString()} characters or fewer.`;
    }
  }

  if (issue.code === 'invalid_type') {
    return `The field "${path}" is missing or has the wrong type.`;
  }

  return `Invalid ${path}: ${issue.message}`;
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return new ChatSDKError('bad_request:api').toResponse();
  }

  // Unified session (Clerk or guest)
  const session = await getAppSession();

  if (!session?.user) {
    return new ChatSDKError('unauthorized:chat').toResponse();
  }

  const chat = await getChatById({ id });

  if (chat?.userId !== session.user.id) {
    return new ChatSDKError('forbidden:chat').toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
