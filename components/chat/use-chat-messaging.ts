import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { DataUIPart } from 'ai';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import equal from 'fast-deep-equal';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/toast';
import type { ChatPreferences } from './use-chat-preferences';
import { ChatSDKError } from '@/lib/errors';
import type { ChatMessage, CustomUIDataTypes } from '@/lib/types';
import type { MessageTreeResult, MessageTreeNode } from '@/lib/db/schema';
import type { AppUsage } from '@/lib/usage';
import type { BranchSelectionSnapshot } from '@/types/chat-bootstrap';
import {
  convertToUIMessages,
  fetchWithErrorHandlers,
  generateUUID,
  getTextFromMessage,
} from '@/lib/utils';
import { buildEditedUserMessageParts } from '@/lib/message-editing';
import type { VisibilityType } from '../visibility-selector';
import {
  branchMessageAction,
  forkChatAction,
  updateBranchSelection,
} from '@/app/(chat)/actions';
import type React from 'react';
import type { MessageDeletionMode } from '@/lib/message-deletion';

const IS_E2E = process.env.NEXT_PUBLIC_E2E === '1';

export type SelectionApi = {
  getSelectedIds: () => string[];
  removeFromSelection: (ids: string[]) => void;
  clearSelection: () => void;
  setSelection: (ids: string[]) => void;
};

export type UseChatMessagingArgs = {
  chatId: string;
  initialMessageTree?: MessageTreeResult;
  initialMessages: ChatMessage[];
  visibilityType: VisibilityType;
  isReadonly: boolean;
  preferences: ChatPreferences;
  setUsage: (usage: AppUsage | undefined) => void;
  setDataStream: React.Dispatch<
    React.SetStateAction<DataUIPart<CustomUIDataTypes>[]>
  >;
  selection: SelectionApi;
};

type BranchSelectionOperation =
  | { kind: 'root'; rootMessageIndex: number | null }
  | { kind: 'child'; parentId: string; selectedChildIndex: number | null };

export type SelectionUpdateState = {
  id: symbol;
  operation: BranchSelectionOperation;
  status: 'pending' | 'success' | 'error';
  promise: Promise<void>;
  error: unknown;
};

type SelectionUpdateRef = {
  current: SelectionUpdateState | null;
};

export const drainSelectionUpdateRef = (
  ref: SelectionUpdateRef
): Promise<void> | null => {
  const attempt = ref.current;
  if (!attempt) {
    return null;
  }

  if (attempt.status === 'pending') {
    return attempt.promise.then(() => {
      const followUp = drainSelectionUpdateRef(ref);
      if (followUp) {
        return followUp;
      }
    });
  }

  if (attempt.status === 'error') {
    const error =
      attempt.error instanceof Error
        ? attempt.error
        : new Error('Failed to switch message version.');
    ref.current = null;
    return Promise.reject(error);
  }

  if (ref.current === attempt) {
    ref.current = null;
  }

  return drainSelectionUpdateRef(ref);
};

export type TreeUpdateDeferOptions = {
  allowDuringStreaming?: boolean;
  ignoreSelectionAlignment?: boolean;
};

const toTimestamp = (value: Date | string | number | null | undefined) => {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

const pickByIndexOrLatest = (
  siblings: MessageTreeNode[],
  preferredIndex?: number | null
): MessageTreeNode | undefined => {
  if (!siblings.length) {
    return undefined;
  }

  if (
    preferredIndex !== null &&
    preferredIndex !== undefined &&
    Number.isFinite(preferredIndex)
  ) {
    const candidate = siblings.find(
      (node) => node.siblingIndex === preferredIndex
    );
    if (candidate) {
      return candidate;
    }
  }

  return siblings.reduce((latest, node) => {
    const latestTimestamp = toTimestamp(latest.createdAt);
    const nodeTimestamp = toTimestamp(node.createdAt);

    if (nodeTimestamp > latestTimestamp) {
      return node;
    }

    if (nodeTimestamp === latestTimestamp) {
      return node.pathText.localeCompare(latest.pathText) > 0 ? node : latest;
    }

    return latest;
  }, siblings[0]);
};

const cloneSelectionSnapshot = (
  snapshot: BranchSelectionSnapshot
): BranchSelectionSnapshot => {
  const selectionsEntries = snapshot.selections
    ? Object.entries(snapshot.selections)
    : [];
  const selections = selectionsEntries.length
    ? Object.fromEntries(
        selectionsEntries.map(([messageId, index]) => [
          messageId,
          index ?? null,
        ])
      )
    : undefined;

  return {
    rootMessageIndex: snapshot.rootMessageIndex ?? null,
    ...(selections ? { selections } : {}),
  };
};

const ensureSelectionMap = (
  snapshot: BranchSelectionSnapshot
): Record<string, number | null> => {
  if (!snapshot.selections) {
    snapshot.selections = {};
  }
  return snapshot.selections;
};

const areSelectionSnapshotsEqual = (
  a: BranchSelectionSnapshot | null,
  b: BranchSelectionSnapshot | null
): boolean => {
  if (a === b) return true;
  if (!a || !b) return false;
  if ((a.rootMessageIndex ?? null) !== (b.rootMessageIndex ?? null)) {
    return false;
  }

  const aSelections = a.selections ?? {};
  const bSelections = b.selections ?? {};
  const aKeys = Object.keys(aSelections);
  const bKeys = Object.keys(bSelections);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    if ((aSelections[key] ?? null) !== (bSelections[key] ?? null)) {
      return false;
    }
  }
  return true;
};

export function shouldDeferTreeUpdate({
  chatStatus,
  pendingRegenerationId,
  desiredSelection,
  treeSelection,
  options,
}: {
  chatStatus: ReturnType<typeof useChat>['status'];
  pendingRegenerationId: string | null;
  desiredSelection: BranchSelectionSnapshot | null;
  treeSelection: BranchSelectionSnapshot | null;
  options?: TreeUpdateDeferOptions;
}): boolean {
  const allowDuringStreaming = options?.allowDuringStreaming ?? false;
  const ignoreSelectionAlignment = options?.ignoreSelectionAlignment ?? false;

  if (
    !allowDuringStreaming &&
    (chatStatus === 'submitted' ||
      chatStatus === 'streaming' ||
      pendingRegenerationId !== null)
  ) {
    return true;
  }

  if (
    !ignoreSelectionAlignment &&
    desiredSelection !== null &&
    treeSelection !== null &&
    !areSelectionSnapshotsEqual(desiredSelection, treeSelection)
  ) {
    return true;
  }

  return false;
}

export const buildSelectionSnapshot = (
  tree: MessageTreeResult
): BranchSelectionSnapshot => {
  const selections: Record<string, number | null> = {};
  for (const node of tree.nodes) {
    if (node.selectedChildIndex !== undefined) {
      selections[node.id] = node.selectedChildIndex ?? null;
    }
  }

  const normalizedSelections = Object.keys(selections).length
    ? selections
    : undefined;

  return {
    rootMessageIndex: tree.rootMessageIndex ?? null,
    ...(normalizedSelections ? { selections: normalizedSelections } : {}),
  };
};

export const computeBranchFromSelection = (
  tree: MessageTreeResult,
  selection: BranchSelectionSnapshot
): MessageTreeNode[] => {
  const branch: MessageTreeNode[] = [];
  const roots = tree.tree;
  if (!roots.length) {
    return branch;
  }

  const rootNode = pickByIndexOrLatest(roots, selection.rootMessageIndex);
  let cursor = rootNode;

  while (cursor) {
    branch.push(cursor);
    const overrides = selection.selections ?? {};
    const preferredChildIndex = Object.prototype.hasOwnProperty.call(
      overrides,
      cursor.id
    )
      ? (overrides[cursor.id] ?? null)
      : (cursor.selectedChildIndex ?? null);

    cursor = pickByIndexOrLatest(cursor.children, preferredChildIndex);
  }

  return branch;
};

export type BranchSwitchPlan = {
  branch: MessageTreeNode[];
  snapshot: BranchSelectionSnapshot;
  operation: BranchSelectionOperation;
};

export const planBranchSwitch = ({
  tree,
  selection,
  messageId,
  direction,
}: {
  tree: MessageTreeResult;
  selection: BranchSelectionSnapshot;
  messageId: string;
  direction: 'next' | 'prev';
}): BranchSwitchPlan | null => {
  if (!tree) {
    return null;
  }

  const nodesById = new Map<string, MessageTreeNode>();
  const nodesByPath = new Map<string, MessageTreeNode>();

  for (const node of tree.nodes) {
    nodesById.set(node.id, node);
    if (node.pathText) {
      nodesByPath.set(node.pathText, node);
    }
  }

  const currentNode = nodesById.get(messageId);
  if (!currentNode) {
    return null;
  }

  const parent = currentNode.parentPath
    ? nodesByPath.get(currentNode.parentPath)
    : null;

  const siblings = parent ? parent.children : tree.tree;
  if (!siblings || siblings.length < 2) {
    return null;
  }

  const currentIndex = siblings.findIndex((child) => child.id === messageId);
  if (currentIndex === -1) {
    return null;
  }

  const nextIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
  if (nextIndex < 0 || nextIndex >= siblings.length) {
    return null;
  }

  const targetNode = siblings[nextIndex];
  const nextSnapshot = cloneSelectionSnapshot(selection);
  let operation: BranchSelectionOperation;

  if (!parent) {
    operation = { kind: 'root', rootMessageIndex: targetNode.siblingIndex };
    nextSnapshot.rootMessageIndex = targetNode.siblingIndex;
  } else {
    operation = {
      kind: 'child',
      parentId: parent.id,
      selectedChildIndex: targetNode.siblingIndex,
    };
    const selections = ensureSelectionMap(nextSnapshot);
    selections[parent.id] = targetNode.siblingIndex;
  }

  const branch = computeBranchFromSelection(tree, nextSnapshot);
  if (!branch.length) {
    return null;
  }

  return { branch, snapshot: nextSnapshot, operation };
};

export function useChatMessaging({
  chatId,
  initialMessageTree,
  initialMessages,
  visibilityType,
  isReadonly,
  preferences,
  setUsage,
  setDataStream,
  selection,
}: UseChatMessagingArgs) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const {
    getSelectedIds,
    removeFromSelection,
    clearSelection,
    setSelection: assignSelection,
  } = selection;

  const currentMessageTreeRef = useRef<MessageTreeResult | undefined>(
    initialMessageTree
  );
  const messagesRef = useRef<ChatMessage[]>(initialMessages);
  const chatDeletedRef = useRef(false);
  const regenerationStartedRef = useRef(false);
  const selectionUpdateRef = useRef<SelectionUpdateState | null>(null);
  const selectionRef = useRef<BranchSelectionSnapshot | null>(
    initialMessageTree
      ? buildSelectionSnapshot(initialMessageTree)
      : { rootMessageIndex: null }
  );
  const treeSyncRef = useRef<Promise<void> | null>(null);
  const deferredTreeRef = useRef<MessageTreeResult | null>(null);
  const pendingPostStreamSyncRef = useRef(false);

  const [pendingRegenerationId, setPendingRegenerationId] = useState<
    string | null
  >(null);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const branchSelectionMutation = useMutation<
    void,
    ChatSDKError | Error,
    {
      operation: BranchSelectionOperation;
      expectedSnapshot: BranchSelectionSnapshot | null;
    }
  >({
    mutationFn: async ({ operation, expectedSnapshot }) => {
      await updateBranchSelection({
        chatId,
        operation,
        expectedSnapshot: expectedSnapshot ?? undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat', 'history'] });
    },
  });

  const { mutateAsync: persistBranchSelectionAsync } = branchSelectionMutation;

  const {
    currentModelIdRef,
    stagedPinnedSlugsRef,
    stagedAllowedToolsRef,
    stagedReasoningEffortRef,
    stagedAgentIdRef,
    chatHasStartedRef,
    markChatAsStarted,
  } = preferences;

  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    resumeStream,
    regenerate,
    error: chatError,
    clearError: clearChatError,
  } = useChat<ChatMessage>({
    id: chatId,
    messages: initialMessages,
    experimental_throttle: 100,
    generateId: generateUUID,
    transport: new DefaultChatTransport({
      api: '/api/chat',
      fetch: fetchWithErrorHandlers as typeof fetch,
      prepareSendMessagesRequest(request) {
        const stagedPins = stagedPinnedSlugsRef.current;
        const stagedTools = stagedAllowedToolsRef.current;
        const stagedEffort = stagedReasoningEffortRef.current;
        const stagedAgentId = stagedAgentIdRef.current;
        const isRegenerationTrigger =
          request.trigger === 'regenerate-message' &&
          typeof request.messageId === 'string';
        let outgoingMessage = request.messages.at(-1);
        if (isRegenerationTrigger) {
          for (
            let index = request.messages.length - 1;
            index >= 0;
            index -= 1
          ) {
            const candidate = request.messages[index];
            if (candidate?.role === 'user') {
              outgoingMessage = candidate;
              break;
            }
          }
        }
        return {
          body: {
            ...request.body,
            id: request.id,
            message: outgoingMessage,
            regenerateMessageId: isRegenerationTrigger
              ? request.messageId
              : undefined,
            selectedChatModel: currentModelIdRef.current,
            selectedVisibilityType: visibilityType,
            pinnedSlugs: stagedPins.length > 0 ? stagedPins : undefined,
            allowedTools: !chatHasStartedRef.current ? stagedTools : undefined,
            reasoningEffort: !chatHasStartedRef.current
              ? stagedEffort
              : undefined,
            agentId: !chatHasStartedRef.current ? stagedAgentId : undefined,
          },
        };
      },
    }),
    onData: (dataPart) => {
      setDataStream((previous) => (previous ? [...previous, dataPart] : []));
      if (dataPart.type === 'data-usage') {
        setUsage(dataPart.data);
      }
    },
    onFinish: () => {
      queryClient.invalidateQueries({ queryKey: ['chat', 'history'] });
      if (!chatHasStartedRef.current) {
        markChatAsStarted();
      }
    },
    onError: (error) => {
      if (error instanceof ChatSDKError) {
        toast({ type: 'error', description: error.message });
      }
    },
  });

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const seenIds = new Set<string>();
    const deduped: ChatMessage[] = [];

    for (const message of messages) {
      if (!seenIds.has(message.id)) {
        seenIds.add(message.id);
        deduped.push(message);
      }
    }

    // Only update if duplicates were found
    if (deduped.length === messages.length) {
      return;
    }

    setMessages((current) => {
      // Avoid triggering extra renders if deduped content matches current.
      if (current.length === deduped.length) {
        let equal = true;
        for (let i = 0; i < current.length; i += 1) {
          if (current[i] !== deduped[i]) {
            equal = false;
            break;
          }
        }
        if (equal) {
          return current;
        }
      }
      return deduped;
    });
  }, [messages, setMessages]);

  const chatStatusRef = useRef(status);
  useEffect(() => {
    chatStatusRef.current = status;
  }, [status]);

  const pendingRegenerationIdRef = useRef<string | null>(pendingRegenerationId);
  useEffect(() => {
    pendingRegenerationIdRef.current = pendingRegenerationId;
  }, [pendingRegenerationId]);

  const applyTreeSnapshot = useCallback(
    (tree: MessageTreeResult) => {
      currentMessageTreeRef.current = tree;
      selectionRef.current = buildSelectionSnapshot(tree);

      setMessages((current) => {
        const next = convertToUIMessages(tree.branch);
        if (equal(current, next)) {
          return current;
        }
        return next;
      });
    },
    [setMessages]
  );

  const updateTreeSnapshot = useCallback(
    (
      tree: MessageTreeResult,
      options?: {
        allowDuringStreaming?: boolean;
        ignoreSelectionAlignment?: boolean;
      }
    ) => {
      const shouldDefer = shouldDeferTreeUpdate({
        chatStatus: chatStatusRef.current,
        pendingRegenerationId: pendingRegenerationIdRef.current,
        desiredSelection: selectionRef.current ?? null,
        treeSelection: buildSelectionSnapshot(tree),
        options,
      });

      if (shouldDefer) {
        deferredTreeRef.current = tree;
        return;
      }

      deferredTreeRef.current = null;
      applyTreeSnapshot(tree);
    },
    [applyTreeSnapshot]
  );

  const refreshMessageTree = useCallback(async () => {
    if (IS_E2E) {
      return;
    }
    if (treeSyncRef.current) {
      return treeSyncRef.current;
    }

    const promise = (async () => {
      try {
        const { getMessageTreeAction } = await import('@/app/(chat)/actions');
        const tree = await getMessageTreeAction({ chatId });
        updateTreeSnapshot(tree);
      } catch (error) {
        console.error('Failed to refresh message tree', error);
      } finally {
        treeSyncRef.current = null;
      }
    })();

    treeSyncRef.current = promise;
    return promise;
  }, [chatId, updateTreeSnapshot]);

  useEffect(() => {
    if (status === 'submitted' || status === 'streaming') {
      pendingPostStreamSyncRef.current = true;
      return;
    }

    if (status !== 'ready') {
      return;
    }

    if (pendingPostStreamSyncRef.current) {
      pendingPostStreamSyncRef.current = false;
      refreshMessageTree();
      return;
    }

    if (pendingRegenerationId === null && deferredTreeRef.current) {
      const pendingTree = deferredTreeRef.current;
      deferredTreeRef.current = null;
      updateTreeSnapshot(pendingTree, { allowDuringStreaming: true });
    }
  }, [status, pendingRegenerationId, refreshMessageTree, updateTreeSnapshot]);

  const handleChatDeleted = useCallback(() => {
    if (chatDeletedRef.current) {
      return;
    }

    chatDeletedRef.current = true;
    clearSelection();
    setMessages([]);
    selectionRef.current = { rootMessageIndex: null };
    router.replace('/chat');
    queryClient.invalidateQueries({ queryKey: ['chat', 'history'] });
  }, [clearSelection, queryClient, router, setMessages]);

  const handleDeleteMessage = useCallback(
    async (messageId: string, mode: MessageDeletionMode) => {
      if (isReadonly) {
        return { chatDeleted: false } as const;
      }

      const previousSelection = [...getSelectedIds()];
      removeFromSelection([messageId]);

      try {
        const response = await fetchWithErrorHandlers(
          `/api/chat/${chatId}/messages/${messageId}?mode=${encodeURIComponent(mode)}`,
          {
            method: 'DELETE',
          }
        );

        const payload = await response.json().catch(() => null);
        const chatDeleted = Boolean(payload?.chatDeleted);

        if (chatDeleted || messagesRef.current.length === 0) {
          handleChatDeleted();
          return { chatDeleted: true } as const;
        }

        await refreshMessageTree();

        const currentMessages = messagesRef.current;
        const remainingIds = new Set(
          currentMessages.map((message) => message.id)
        );
        const filteredSelection = previousSelection.filter((id) =>
          remainingIds.has(id)
        );
        assignSelection(filteredSelection);

        return { chatDeleted: false } as const;
      } catch (error) {
        assignSelection(previousSelection);
        throw error;
      }
    },
    [
      assignSelection,
      chatId,
      getSelectedIds,
      handleChatDeleted,
      isReadonly,
      refreshMessageTree,
      removeFromSelection,
    ]
  );

  const handleDeleteSelected = useCallback(
    async (mode: MessageDeletionMode) => {
      if (isReadonly) return;
      const ids = getSelectedIds();
      if (!ids.length) return;

      setIsBulkDeleting(true);
      let previousMessages: ChatMessage[] = [];
      const previousSelection = [...ids];
      setMessages((current) => {
        previousMessages = [...current];
        return current.filter((message) => !ids.includes(message.id));
      });

      try {
        const response = await fetchWithErrorHandlers(
          `/api/chat/${chatId}/messages`,
          {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messageIds: ids, mode }),
          }
        );

        const payload = await response.json().catch(() => null);
        const chatDeleted = Boolean(payload?.chatDeleted);

        if (chatDeleted || messagesRef.current.length === 0) {
          toast({ type: 'success', description: 'Chat deleted.' });
          handleChatDeleted();
          return;
        }

        await refreshMessageTree();
        clearSelection();

        let successDescription = 'Messages deleted.';
        if (mode === 'message-with-following') {
          successDescription = 'Messages and following deleted.';
        } else if (mode === 'message-only') {
          successDescription = 'Messages deleted; following preserved.';
        } else if (mode === 'version') {
          successDescription = 'Message versions deleted.';
        }
        toast({ type: 'success', description: successDescription });
      } catch (error) {
        setMessages(previousMessages);
        assignSelection(previousSelection);
        if (error instanceof ChatSDKError) {
          toast({ type: 'error', description: error.message });
        } else {
          toast({ type: 'error', description: 'Failed to delete messages.' });
        }
      } finally {
        setIsBulkDeleting(false);
      }
    },
    [
      assignSelection,
      chatId,
      clearSelection,
      getSelectedIds,
      handleChatDeleted,
      isReadonly,
      refreshMessageTree,
      setMessages,
    ]
  );

  const handleForkMessage = useCallback(
    async (messageId: string) => {
      if (isReadonly) {
        return;
      }

      const target = messagesRef.current.find(
        (message) => message.id === messageId
      );
      if (!target) {
        toast({ type: 'error', description: 'Message not found.' });
        return;
      }

      const mode = target.role === 'assistant' ? 'clone' : 'edit';

      let editedText: string | undefined;
      if (mode === 'edit') {
        editedText = getTextFromMessage(target).trim();
        if (!editedText) {
          toast({
            type: 'error',
            description: 'Cannot fork this message without editable text.',
          });
          return;
        }
      }

      toast({ type: 'success', description: 'Forking chat…' });

      try {
        const { newChatId } = await forkChatAction({
          sourceChatId: chatId,
          pivotMessageId: target.id,
          mode,
          editedText,
        });

        queryClient.invalidateQueries({ queryKey: ['chat', 'history'] });
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ['chat', 'history'] });
        }, 8000);

        const shouldRegenerate = target.role === 'user';
        router.push(
          `/chat/${newChatId}${shouldRegenerate ? '?regenerate=true' : ''}`
        );
      } catch (error) {
        console.error('Fork failed', error);
        toast({ type: 'error', description: 'Failed to fork chat.' });
      }
    },
    [chatId, isReadonly, queryClient, router]
  );

  useEffect(() => {
    if (!pendingRegenerationId) {
      regenerationStartedRef.current = false;
      return;
    }

    if (status === 'submitted' || status === 'streaming') {
      regenerationStartedRef.current = true;
    }
  }, [pendingRegenerationId, status]);

  useEffect(() => {
    if (!pendingRegenerationId) {
      return;
    }
    if (status === 'submitted' || status === 'streaming') {
      return;
    }
    if (!regenerationStartedRef.current) {
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const { getMessageTreeAction } = await import('@/app/(chat)/actions');
        const tree = await getMessageTreeAction({ chatId });
        if (cancelled) return;
        currentMessageTreeRef.current = tree;
        setMessages(convertToUIMessages(tree.branch));
        queryClient.invalidateQueries({ queryKey: ['chat', 'history'] });
      } catch (error) {
        if (!cancelled) {
          console.error(
            'Failed to refresh message tree after regeneration',
            error
          );
        }
      } finally {
        if (!cancelled) {
          setPendingRegenerationId(null);
          regenerationStartedRef.current = false;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chatId, pendingRegenerationId, queryClient, setMessages, status]);

  const disableRegenerate =
    status === 'submitted' ||
    status === 'streaming' ||
    pendingRegenerationId !== null;

  const ensureBranchReady = useCallback(
    (): Promise<void> | null => drainSelectionUpdateRef(selectionUpdateRef),
    []
  );

  const handleRegenerateAssistant = useCallback(
    async (assistantMessageId: string) => {
      if (status === 'submitted' || status === 'streaming') {
        return;
      }
      if (pendingRegenerationId) {
        return;
      }

      const readiness = ensureBranchReady();
      if (readiness) {
        try {
          await readiness;
        } catch (error) {
          console.warn('Regeneration blocked while switching branches', error);
          toast({
            type: 'error',
            description:
              'Unable to regenerate while switching versions. Please try again.',
          });
          return;
        }
      }

      setPendingRegenerationId(assistantMessageId);
      toast({ type: 'success', description: 'Regenerating message…' });
      try {
        regenerate({ messageId: assistantMessageId });
      } catch (error) {
        console.error('Regenerate request failed', error);
        toast({
          type: 'error',
          description: 'Failed to start regeneration.',
        });
        setPendingRegenerationId(null);
      }
    },
    [ensureBranchReady, pendingRegenerationId, regenerate, status]
  );

  const sendMessageWithBranchGuard = useCallback<typeof sendMessage>(
    (payload) => {
      const readiness = ensureBranchReady();
      if (!readiness) {
        return sendMessage(payload);
      }

      return readiness
        .then(() => sendMessage(payload))
        .catch((error) => {
          console.warn(
            'Skipping message send due to branch switch failure',
            error
          );
          toast({
            type: 'error',
            description:
              'Unable to switch to the selected response version. Message not sent.',
          });
        });
    },
    [ensureBranchReady, sendMessage]
  );

  const handleEditMessage = useCallback(
    async (messageId: string, editedText: string) => {
      if (isReadonly) {
        return;
      }

      const trimmed = editedText.trim();
      if (!trimmed) {
        toast({
          type: 'error',
          description: 'Message cannot be empty.',
        });
        throw new ChatSDKError('bad_request:chat');
      }

      const readiness = ensureBranchReady();
      if (readiness) {
        try {
          await readiness;
        } catch (error) {
          toast({
            type: 'error',
            description:
              'Unable to update message while switching versions. Please try again.',
          });
          throw error;
        }
      }

      const currentMessages = messagesRef.current;
      const targetIndex = currentMessages.findIndex(
        (message) => message.id === messageId
      );

      if (targetIndex === -1) {
        toast({ type: 'error', description: 'Message not found.' });
        throw new ChatSDKError('not_found:chat');
      }

      const targetMessage = currentMessages[targetIndex];
      const existingText = getTextFromMessage(targetMessage).trim();
      if (existingText === trimmed) {
        return;
      }

      const previousMessages = [...currentMessages];
      const previousTree = currentMessageTreeRef.current;
      const previousSnapshot =
        selectionRef.current !== null
          ? cloneSelectionSnapshot(selectionRef.current)
          : null;
      const previousSelectionIds = [...getSelectedIds()];

      if (targetMessage.role === 'user') {
        const removedSelectionIds = previousMessages
          .slice(targetIndex)
          .map((message) => message.id);
        if (removedSelectionIds.length > 0) {
          removeFromSelection(removedSelectionIds);
        }

        const editedParts = buildEditedUserMessageParts(targetMessage, trimmed);

        setMessages((current) => {
          if (!current[targetIndex]) {
            return current;
          }
          const next = [...current];
          next[targetIndex] = {
            ...next[targetIndex],
            parts: editedParts,
          };
          return next;
        });

        try {
          const { newMessageId } = await branchMessageAction({
            chatId,
            messageId,
            editedText: trimmed,
          });

          const optimisticUserMessage: ChatMessage = {
            id: newMessageId,
            role: 'user',
            parts: editedParts,
            metadata: {
              createdAt:
                targetMessage.metadata?.createdAt ?? new Date().toISOString(),
              model: targetMessage.metadata?.model,
              siblingIndex: targetMessage.metadata?.siblingIndex ?? 0,
              siblingsCount: Math.max(
                targetMessage.metadata?.siblingsCount ?? 1,
                1
              ),
            },
          };

          setMessages([
            ...previousMessages.slice(0, targetIndex),
            optimisticUserMessage,
          ]);

          selectionRef.current = null;
          currentMessageTreeRef.current = undefined;

          await sendMessageWithBranchGuard({
            id: newMessageId,
            role: 'user',
            parts: editedParts,
          });

          // Remove any duplicate messages that might have been added during the send process
          setMessages((current) => {
            const uniqueMessages = [];
            const seenIds = new Set();

            for (const message of current) {
              if (!seenIds.has(message.id)) {
                seenIds.add(message.id);
                uniqueMessages.push(message);
              }
            }

            return uniqueMessages;
          });

          toast({ type: 'success', description: 'Message updated.' });

          await refreshMessageTree();
          queryClient.invalidateQueries({ queryKey: ['chat', 'history'] });
        } catch (error) {
          setMessages(previousMessages);
          assignSelection(previousSelectionIds);
          currentMessageTreeRef.current = previousTree;
          selectionRef.current = previousSnapshot
            ? cloneSelectionSnapshot(previousSnapshot)
            : null;

          if (error instanceof ChatSDKError) {
            toast({ type: 'error', description: error.message });
          } else {
            toast({ type: 'error', description: 'Failed to update message.' });
          }

          throw error;
        }

        return;
      }

      const optimisticId = generateUUID();
      const optimisticMessage: ChatMessage = {
        id: optimisticId,
        role: targetMessage.role,
        parts: [{ type: 'text', text: trimmed }],
        metadata: {
          createdAt:
            targetMessage.metadata?.createdAt ?? new Date().toISOString(),
          model: targetMessage.metadata?.model,
          siblingIndex: targetMessage.metadata?.siblingIndex ?? 0,
          siblingsCount: Math.max(
            targetMessage.metadata?.siblingsCount ?? 1,
            1
          ),
        },
      };

      const truncatedMessages = [
        ...previousMessages.slice(0, targetIndex),
        optimisticMessage,
      ];

      setMessages(truncatedMessages);
      selectionRef.current = null;
      currentMessageTreeRef.current = undefined;

      try {
        await branchMessageAction({
          chatId,
          messageId,
          editedText: trimmed,
        });

        toast({ type: 'success', description: 'Message updated.' });

        await refreshMessageTree();
        queryClient.invalidateQueries({ queryKey: ['chat', 'history'] });
      } catch (error) {
        setMessages(previousMessages);
        assignSelection(previousSelectionIds);
        currentMessageTreeRef.current = previousTree;
        selectionRef.current = previousSnapshot
          ? cloneSelectionSnapshot(previousSnapshot)
          : null;

        if (error instanceof ChatSDKError) {
          toast({ type: 'error', description: error.message });
        } else {
          toast({ type: 'error', description: 'Failed to update message.' });
        }

        throw error;
      }
    },
    [
      assignSelection,
      chatId,
      ensureBranchReady,
      getSelectedIds,
      isReadonly,
      queryClient,
      refreshMessageTree,
      removeFromSelection,
      sendMessageWithBranchGuard,
      setMessages,
    ]
  );

  const handleNavigate = useCallback(
    (messageId: string, direction: 'next' | 'prev') => {
      if (status === 'submitted' || status === 'streaming') {
        toast({
          type: 'error',
          description:
            'Finish generating the current response before switching versions.',
        });
        return;
      }

      const tree = currentMessageTreeRef.current;
      if (!tree) return;

      const readiness = ensureBranchReady();
      if (readiness) {
        readiness.catch(() => undefined);
      }

      const activeSelection =
        selectionRef.current ??
        ({ rootMessageIndex: null } as BranchSelectionSnapshot);
      const plan = planBranchSwitch({
        tree,
        selection: activeSelection,
        messageId,
        direction,
      });

      if (!plan) {
        return;
      }

      const nextMessages = convertToUIMessages(plan.branch);
      if (!nextMessages.length) {
        return;
      }

      const previousMessages = [...messagesRef.current];
      const previousBranch = [...tree.branch];
      const previousSelection =
        selectionRef.current !== null
          ? cloneSelectionSnapshot(selectionRef.current)
          : null;

      setMessages(nextMessages);
      selectionRef.current = plan.snapshot;
      currentMessageTreeRef.current = {
        ...tree,
        branch: plan.branch,
      };

      const attemptId = Symbol('branch-switch');
      let rolledBack = false;
      const rollback = () => {
        if (rolledBack) return;
        rolledBack = true;
        setMessages(() => [...previousMessages]);
        currentMessageTreeRef.current = {
          ...tree,
          branch: previousBranch,
        };
        if (previousSelection) {
          selectionRef.current = cloneSelectionSnapshot(previousSelection);
        }
      };
      // Persist selection updates sequentially so rapid navigation does not race older state.
      const previousAttempt = selectionUpdateRef.current;
      const basePromise = previousAttempt
        ? previousAttempt.promise.catch(() => undefined)
        : Promise.resolve();

      const managedPromise = basePromise
        .then(() =>
          persistBranchSelectionAsync({
            operation: plan.operation,
            expectedSnapshot: previousSelection,
          })
        )
        .then(() => {
          if (selectionUpdateRef.current?.id === attemptId) {
            selectionUpdateRef.current = {
              id: attemptId,
              operation: plan.operation,
              status: 'success',
              promise: Promise.resolve(),
              error: null,
            };
          }

          return refreshMessageTree();
        })
        .catch((error) => {
          if (selectionUpdateRef.current?.id === attemptId) {
            rollback();
            selectionUpdateRef.current = {
              id: attemptId,
              operation: plan.operation,
              status: 'error',
              promise: Promise.resolve(),
              error,
            };
          }

          const refreshPromise = refreshMessageTree();
          if (refreshPromise) {
            return refreshPromise.then(() => {
              throw error;
            });
          }
          throw error;
        })
        .finally(() => {
          if (
            selectionUpdateRef.current?.id === attemptId &&
            selectionUpdateRef.current.status !== 'error'
          ) {
            selectionUpdateRef.current = null;
          }
        });

      selectionUpdateRef.current = {
        id: attemptId,
        operation: plan.operation,
        status: 'pending',
        promise: managedPromise,
        error: null,
      };
    },
    [
      ensureBranchReady,
      status,
      persistBranchSelectionAsync,
      refreshMessageTree,
      setMessages,
    ]
  );

  useEffect(() => {
    if (status !== 'ready') {
      return;
    }

    if (treeSyncRef.current) {
      return;
    }

    const tree = currentMessageTreeRef.current;
    if (!tree) {
      if (messages.length > 0) {
        refreshMessageTree();
      }
      return;
    }

    const knownIds = new Set(tree.nodes.map((node) => node.id));
    const hasMissing = messages.some((message) => !knownIds.has(message.id));

    if (hasMissing) {
      refreshMessageTree();
    }
  }, [messages, refreshMessageTree, status]);

  return {
    messages,
    setMessages,
    sendMessage: sendMessageWithBranchGuard,
    status,
    stop,
    resumeStream,
    regenerate,
    chatError,
    clearChatError,
    handleDeleteMessage,
    handleDeleteSelected,
    handleForkMessage,
    handleEditMessage,
    handleRegenerateAssistant,
    handleNavigate,
    disableRegenerate,
    isBulkDeleting,
  } as const;
}
