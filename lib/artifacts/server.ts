import type { ModelMessage, UIMessageStreamWriter } from 'ai';
import type { AppSession } from '@/lib/auth/session';
import { codeDocumentHandler } from '@/artifacts/code/server';
import { sheetDocumentHandler } from '@/artifacts/sheet/server';
import { textDocumentHandler } from '@/artifacts/text/server';
import type { ArtifactKind } from '@/components/artifact';
import { saveDocument } from '../db/queries';
import type { Document } from '../db/schema';
import type { ChatMessage } from '../types';
import type { CodeLanguage } from '../code/languages';
import type { Prisma } from '../../generated/prisma-client/client';

export type ArtifactToolContext = {
  modelId?: string;
  model?: unknown;
  providerOptions?: Record<string, any>;
  systemPrompt?: string;
  messages?: ModelMessage[];
  reasoningEffort?: 'low' | 'medium' | 'high';
};

export type DocumentDraftResult<M = Prisma.JsonValue> = {
  content: string;
  metadata?: M;
};

export type SaveDocumentProps = {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  userId: string;
  metadata?: Prisma.JsonValue | null;
};

export type CreateDocumentCallbackProps = {
  id: string;
  title: string;
  dataStream: UIMessageStreamWriter<ChatMessage>;
  session: AppSession;
  context: ArtifactToolContext;
  requestedLanguage?: CodeLanguage;
  invocationMessages?: ModelMessage[];
  assistantPrelude?: string;
};

export type UpdateDocumentCallbackProps = {
  document: Document;
  description: string;
  dataStream: UIMessageStreamWriter<ChatMessage>;
  session: AppSession;
  context: ArtifactToolContext;
  invocationMessages?: ModelMessage[];
  assistantPrelude?: string;
};

export type DocumentHandler<
  T = ArtifactKind,
  M extends Prisma.JsonValue | undefined = Prisma.JsonValue,
> = {
  kind: T;
  onCreateDocument: (
    args: CreateDocumentCallbackProps
  ) => Promise<DocumentDraftResult<M>>;
  onUpdateDocument: (
    args: UpdateDocumentCallbackProps
  ) => Promise<DocumentDraftResult<M>>;
};

export function createDocumentHandler<
  T extends ArtifactKind,
  M extends Prisma.JsonValue | undefined = Prisma.JsonValue,
>(config: {
  kind: T;
  onCreateDocument: (
    params: CreateDocumentCallbackProps
  ) => Promise<DocumentDraftResult<M>>;
  onUpdateDocument: (
    params: UpdateDocumentCallbackProps
  ) => Promise<DocumentDraftResult<M>>;
}): DocumentHandler<T, M> {
  return {
    kind: config.kind,
    onCreateDocument: async (args: CreateDocumentCallbackProps) => {
      const draftResult = await config.onCreateDocument({
        id: args.id,
        title: args.title,
        dataStream: args.dataStream,
        session: args.session,
        context: args.context,
        requestedLanguage: args.requestedLanguage,
        invocationMessages: args.invocationMessages,
        assistantPrelude: args.assistantPrelude,
      });

      if (args.session?.user?.id) {
        await saveDocument({
          id: args.id,
          title: args.title,
          content: draftResult.content,
          kind: config.kind,
          userId: args.session.user.id,
          metadata: draftResult.metadata ?? null,
        });
      }

      return draftResult;
    },
    onUpdateDocument: async (args: UpdateDocumentCallbackProps) => {
      const draftResult = await config.onUpdateDocument({
        document: args.document,
        description: args.description,
        dataStream: args.dataStream,
        session: args.session,
        context: args.context,
        invocationMessages: args.invocationMessages,
        assistantPrelude: args.assistantPrelude,
      });

      if (args.session?.user?.id) {
        await saveDocument({
          id: args.document.id,
          title: args.document.title,
          content: draftResult.content,
          kind: config.kind,
          userId: args.session.user.id,
          metadata: draftResult.metadata ?? null,
        });
      }

      return draftResult;
    },
  };
}

/*
 * Use this array to define the document handlers for each artifact kind.
 */
export const documentHandlersByArtifactKind: DocumentHandler[] = [
  textDocumentHandler,
  codeDocumentHandler,
  sheetDocumentHandler,
];

export const artifactKinds = ['text', 'code', 'sheet'] as const;
