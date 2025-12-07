/**
 * Types shared between the realtime gateway and web client.
 */

/**
 * Chat change notification actions.
 */
export const ChatAction = {
    CREATED: 'created',
    UPDATED: 'updated',
    DELETED: 'deleted',
} as const;

export type ChatAction = (typeof ChatAction)[keyof typeof ChatAction];

/**
 * WebSocket message types for client-server communication.
 */
export const WsMessageType = {
    // Client -> Server
    SUBSCRIBE: 'subscribe',
    UNSUBSCRIBE: 'unsubscribe',
    PING: 'ping',

    // Server -> Client
    CHAT_CHANGED: 'chat_changed',
    SUBSCRIBED: 'subscribed',
    UNSUBSCRIBED: 'unsubscribed',
    PONG: 'pong',
    ERROR: 'error',
} as const;

export type WsMessageType = (typeof WsMessageType)[keyof typeof WsMessageType];

/**
 * Base WebSocket message structure.
 */
export interface WsMessage<T = unknown> {
    type: WsMessageType;
    payload?: T;
    /** Optional message ID for request/response correlation */
    id?: string;
}

/**
 * Chat change event payload sent to clients.
 */
export interface ChatChangedPayload {
    chatId: string;
    action: ChatAction;
    /** Full chat data (for created/updated) - serialized chat structure */
    chat?: unknown;
    /** Timestamp of the change */
    timestamp: string;
}

/**
 * Error payload sent to clients.
 */
export interface ErrorPayload {
    code: string;
    message: string;
}

/**
 * Subscription confirmation payload.
 */
export interface SubscribedPayload {
    userId: string;
}
