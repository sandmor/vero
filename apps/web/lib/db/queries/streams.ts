import { prisma } from '@vero/db';
import { ChatSDKError } from '../../errors';

export async function createStreamId({
  streamId,
  chatId,
}: {
  streamId: string;
  chatId: string;
}) {
  try {
    await prisma.stream.create({
      data: { id: streamId, chatId, createdAt: new Date() },
    });
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to create stream id'
    );
  }
}

export async function getStreamIdsByChatId({ chatId }: { chatId: string }) {
  try {
    const streamIds = await prisma.stream.findMany({
      where: { chatId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return (streamIds as Array<{ id: string }>).map(({ id }) => id);
  } catch (_error) {
    throw new ChatSDKError(
      'bad_request:database',
      'Failed to get stream ids by chat id'
    );
  }
}
