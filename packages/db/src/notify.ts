/**
 * PostgreSQL NOTIFY utilities for realtime chat change notifications.
 * 
 * IMPORTANT: NOTIFY behavior with transactions:
 * - NOTIFY commands within a transaction are only delivered AFTER the transaction commits.
 * - If the transaction rolls back, the NOTIFY is discarded (not sent).
 * - This ensures clients only receive notifications for changes that actually persisted.
 * 
 * For operations outside transactions, NOTIFY is immediate.
 * 
 * We use raw SQL here because Prisma doesn't have native NOTIFY support.
 */

import { Pool, type PoolClient } from 'pg';

export const CHAT_NOTIFICATION_CHANNEL = 'chat_changes';

/**
 * Notification action types
 */
export const ChatAction = {
    CREATED: 'created',
    UPDATED: 'updated',
    DELETED: 'deleted',
} as const;

export type ChatAction = (typeof ChatAction)[keyof typeof ChatAction];

/**
 * Payload structure for chat notifications.
 */
export interface ChatNotificationPayload {
    userId: string;
    chatId: string;
    action: ChatAction;
    timestamp: string;
}

// Singleton pool for notify operations (reuses connections)
let notifyPool: Pool | null = null;

/**
 * Get or create the notification pool.
 * Uses DATABASE_URL environment variable.
 */
function getNotifyPool(): Pool {
    if (!notifyPool) {
        const connectionString = process.env.DATABASE_URL;
        if (!connectionString) {
            throw new Error('DATABASE_URL environment variable is required for notifications');
        }
        notifyPool = new Pool({
            connectionString,
            max: 5, // Small pool since NOTIFY is lightweight
            idleTimeoutMillis: 30000,
        });
    }
    return notifyPool;
}

/**
 * Send a chat notification via PostgreSQL NOTIFY.
 * 
 * @param payload - The notification payload
 * @param client - Optional PoolClient if called within a transaction. 
 *                 When provided, the NOTIFY will be part of the transaction
 *                 and only sent after commit.
 * 
 * @example
 * // Standalone notification (immediate)
 * await notifyChatChange({ userId: 'user_123', chatId: 'abc', action: 'created' });
 * 
 * @example
 * // Within a transaction (sent after commit)
 * const client = await pool.connect();
 * try {
 *   await client.query('BEGIN');
 *   await client.query('INSERT INTO "Chat" ...');
 *   await notifyChatChange({ userId, chatId, action: 'created' }, client);
 *   await client.query('COMMIT'); // NOTIFY sent here
 * } catch (e) {
 *   await client.query('ROLLBACK'); // NOTIFY discarded
 *   throw e;
 * } finally {
 *   client.release();
 * }
 */
export async function notifyChatChange(
    payload: Omit<ChatNotificationPayload, 'timestamp'>,
    client?: PoolClient
): Promise<void> {
    const fullPayload: ChatNotificationPayload = {
        ...payload,
        timestamp: new Date().toISOString(),
    };

    // Escape single quotes for safe JSON in pg_notify
    const jsonPayload = JSON.stringify(fullPayload).replace(/'/g, "''");
    const sql = `SELECT pg_notify('${CHAT_NOTIFICATION_CHANNEL}', '${jsonPayload}')`;

    if (client) {
        // Use provided client (within transaction)
        await client.query(sql);
    } else {
        // Use pool connection (standalone)
        const pool = getNotifyPool();
        await pool.query(sql);
    }
}

/**
 * Convenience function to notify about a chat creation.
 */
export async function notifyChatCreated(
    userId: string,
    chatId: string,
    client?: PoolClient
): Promise<void> {
    await notifyChatChange({ userId, chatId, action: ChatAction.CREATED }, client);
}

/**
 * Convenience function to notify about a chat update.
 */
export async function notifyChatUpdated(
    userId: string,
    chatId: string,
    client?: PoolClient
): Promise<void> {
    await notifyChatChange({ userId, chatId, action: ChatAction.UPDATED }, client);
}

/**
 * Convenience function to notify about a chat deletion.
 */
export async function notifyChatDeleted(
    userId: string,
    chatId: string,
    client?: PoolClient
): Promise<void> {
    await notifyChatChange({ userId, chatId, action: ChatAction.DELETED }, client);
}

/**
 * Close the notification pool. Should be called on application shutdown.
 */
export async function closeNotifyPool(): Promise<void> {
    if (notifyPool) {
        await notifyPool.end();
        notifyPool = null;
    }
}

/**
 * Get a client from the notification pool for transactional use.
 * 
 * @example
 * const client = await getNotifyClient();
 * try {
 *   await client.query('BEGIN');
 *   // ... your queries ...
 *   await notifyChatChange(payload, client);
 *   await client.query('COMMIT');
 * } catch (e) {
 *   await client.query('ROLLBACK');
 *   throw e;
 * } finally {
 *   client.release();
 * }
 */
export async function getNotifyClient(): Promise<PoolClient> {
    const pool = getNotifyPool();
    return pool.connect();
}
