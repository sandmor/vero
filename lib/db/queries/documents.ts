import type { Prisma } from '../../../generated/prisma-client/client';
import type { ArtifactKind } from '@/components/artifact';
import { prisma } from '../prisma';
import { ChatSDKError } from '../../errors';
import type { Document, Suggestion } from '../schema';

export async function saveDocument({
  id,
  title,
  kind,
  content,
  userId,
  metadata = null,
}: {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  userId: string;
  metadata?: Prisma.InputJsonValue | null;
}) {
  try {
    const created = await prisma.document.create({
      data: {
        id,
        title,
        kind,
        content,
        userId,
        ...(metadata != null ? { metadata } : {}),
        createdAt: new Date(),
      },
    });
    const mapped: Document = {
      ...created,
      kind: created.kind as Document['kind'],
    };
    return [mapped as any];
  } catch (_error) {
    throw new ChatSDKError('bad_request:database', 'Failed to save document');
  }
}

export async function getDocumentsById({
  id,
}: {
  id: string;
}): Promise<Document[]> {
  try {
    const documents = await prisma.document.findMany({
      where: { id },
      orderBy: { createdAt: 'asc' },
    });
    return documents.map((d) => ({ ...d, kind: d.kind as Document['kind'] }));
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get documents by id'
    );
  }
}

export async function getDocumentById({
  id,
}: {
  id: string;
}): Promise<Document | null> {
  try {
    const selectedDocument = await prisma.document.findFirst({
      where: { id },
      orderBy: { createdAt: 'desc' },
    });
    return selectedDocument
      ? ({
          ...selectedDocument,
          kind: selectedDocument.kind as Document['kind'],
        } as Document)
      : null;
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get document by id'
    );
  }
}

export async function deleteDocumentsByIdAfterTimestamp({
  id,
  timestamp,
}: {
  id: string;
  timestamp: Date;
}): Promise<Document[]> {
  try {
    const toDeleteRaw = await prisma.document.findMany({
      where: { id, createdAt: { gt: timestamp } },
      orderBy: { createdAt: 'asc' },
    });
    const toDelete: Document[] = toDeleteRaw.map((d) => ({
      ...d,
      kind: d.kind as Document['kind'],
    }));

    await prisma.suggestion.deleteMany({
      where: {
        documentId: id,
        documentCreatedAt: { gt: timestamp },
      },
    });

    await prisma.document.deleteMany({
      where: { id, createdAt: { gt: timestamp } },
    });
    return toDelete;
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to delete documents by id after timestamp'
    );
  }
}

export async function saveSuggestions({
  suggestions,
}: {
  suggestions: Suggestion[];
}) {
  try {
    await prisma.suggestion.createMany({ data: suggestions });
    return;
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to save suggestions'
    );
  }
}

export async function getSuggestionsByDocumentId({
  documentId,
}: {
  documentId: string;
}) {
  try {
    return await prisma.suggestion.findMany({ where: { documentId } });
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get suggestions by document id'
    );
  }
}
