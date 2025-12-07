/**
 * Chat notification utilities for the web app.
 *
 * These functions send PostgreSQL NOTIFY events to the realtime gateway
 * when chats are created, updated, or deleted.
 *
 * The NOTIFY approach is "best effort" - if it fails, the operation still succeeds.
 * The realtime gateway is designed to be optional, so notification failures
 * should not break the application.
 */

import {
  notifyChatCreated,
  notifyChatUpdated,
  notifyChatDeleted,
} from '@virid/db';

/**
 * Notify that a chat was created.
 * Call this after successfully creating a chat.
 */
export async function notifyOnChatCreated(
  userId: string,
  chatId: string
): Promise<void> {
  try {
    await notifyChatCreated(userId, chatId);
  } catch (error) {
    // Log but don't throw - notifications are best-effort
    console.warn('[Realtime] Failed to notify chat created:', error);
  }
}

/**
 * Notify that a chat was updated.
 * Call this after successfully updating a chat (title, visibility, messages, etc.).
 */
export async function notifyOnChatUpdated(
  userId: string,
  chatId: string
): Promise<void> {
  try {
    await notifyChatUpdated(userId, chatId);
  } catch (error) {
    console.warn('[Realtime] Failed to notify chat updated:', error);
  }
}

/**
 * Notify that a chat was deleted.
 * Call this after successfully deleting a chat.
 */
export async function notifyOnChatDeleted(
  userId: string,
  chatId: string
): Promise<void> {
  try {
    await notifyChatDeleted(userId, chatId);
  } catch (error) {
    console.warn('[Realtime] Failed to notify chat deleted:', error);
  }
}

/**
 * Notify that multiple chats were deleted.
 * Call this after successfully deleting multiple chats.
 */
export async function notifyOnChatsDeleted(
  userId: string,
  chatIds: string[]
): Promise<void> {
  await Promise.all(
    chatIds.map((chatId) => notifyOnChatDeleted(userId, chatId))
  );
}
