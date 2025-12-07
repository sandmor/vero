'use client';

import {
    WsMessageType,
    type WsMessage,
    type ChatChangedPayload,
    type SubscribedPayload,
} from './types';

export type { ChatChangedPayload } from './types';
export { ChatAction } from './types';

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface RealtimeClientOptions {
    /** Gateway WebSocket URL */
    url: string;
    /** Function to get the current Clerk session token */
    getToken: () => Promise<string | null>;
    /** Callback when a chat change event is received */
    onChatChanged?: (payload: ChatChangedPayload) => void;
    /** Callback when connection state changes */
    onStateChange?: (state: ConnectionState) => void;
    /** Callback on errors */
    onError?: (error: Error) => void;
    /** Enable debug logging */
    debug?: boolean;
}

/**
 * Realtime WebSocket client for receiving chat change notifications.
 * 
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Heartbeat ping/pong to detect stale connections
 * - Token refresh on reconnect
 * - Clean disconnect handling
 */
export class RealtimeClient {
    private ws: WebSocket | null = null;
    private state: ConnectionState = 'disconnected';
    private reconnectAttempt = 0;
    private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    private pingInterval: ReturnType<typeof setInterval> | null = null;
    private pendingPong = false;
    private isDestroyed = false;

    private readonly options: Required<Omit<RealtimeClientOptions, 'debug'>> & { debug: boolean };

    // Reconnection constants
    private readonly maxReconnectDelay = 30_000; // 30 seconds max
    private readonly baseReconnectDelay = 1_000; // 1 second base
    private readonly pingIntervalMs = 30_000; // 30 seconds between pings
    private readonly pongTimeoutMs = 10_000; // 10 seconds to receive pong

    constructor(options: RealtimeClientOptions) {
        this.options = {
            url: options.url,
            getToken: options.getToken,
            onChatChanged: options.onChatChanged ?? (() => { }),
            onStateChange: options.onStateChange ?? (() => { }),
            onError: options.onError ?? (() => { }),
            debug: options.debug ?? false,
        };
    }

    /**
     * Connect to the realtime gateway.
     */
    async connect(): Promise<void> {
        if (this.isDestroyed) {
            this.log('Client destroyed, not connecting');
            return;
        }

        if (this.state === 'connected' || this.state === 'connecting') {
            this.log('Already connected or connecting');
            return;
        }

        this.setState(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');

        try {
            const token = await this.options.getToken();
            if (!token) {
                this.log('No token available, not connecting');
                this.setState('disconnected');
                return;
            }

            // Connect with token in query param
            const url = new URL(this.options.url);
            url.searchParams.set('token', token);

            this.ws = new WebSocket(url.toString());

            this.ws.onopen = () => {
                this.log('WebSocket connected');
                this.reconnectAttempt = 0;
                this.setState('connected');
                this.startPingInterval();
            };

            this.ws.onclose = (event) => {
                this.log(`WebSocket closed: code=${event.code} reason=${event.reason}`);
                this.cleanup();
                if (!this.isDestroyed) {
                    this.scheduleReconnect();
                }
            };

            this.ws.onerror = (event) => {
                this.log('WebSocket error', event);
                this.options.onError(new Error('WebSocket connection error'));
            };

            this.ws.onmessage = (event) => {
                this.handleMessage(event.data);
            };
        } catch (error) {
            this.log('Connection error', error);
            this.options.onError(error instanceof Error ? error : new Error(String(error)));
            this.scheduleReconnect();
        }
    }

    /**
     * Disconnect from the gateway.
     */
    disconnect(): void {
        this.log('Disconnecting');
        this.isDestroyed = true;
        this.cleanup();
        this.setState('disconnected');
    }

    /**
     * Get current connection state.
     */
    getState(): ConnectionState {
        return this.state;
    }

    /**
     * Check if connected.
     */
    isConnected(): boolean {
        return this.state === 'connected' && this.ws?.readyState === WebSocket.OPEN;
    }

    private setState(state: ConnectionState): void {
        if (this.state !== state) {
            this.state = state;
            this.options.onStateChange(state);
        }
    }

    private handleMessage(data: unknown): void {
        try {
            const message = JSON.parse(String(data)) as WsMessage;

            switch (message.type) {
                case WsMessageType.SUBSCRIBED:
                    this.log('Subscribed', (message.payload as SubscribedPayload)?.userId);
                    break;

                case WsMessageType.CHAT_CHANGED:
                    this.log('Chat changed', message.payload);
                    this.options.onChatChanged(message.payload as ChatChangedPayload);
                    break;

                case WsMessageType.PONG:
                    this.pendingPong = false;
                    break;

                case WsMessageType.ERROR:
                    this.log('Server error', message.payload);
                    this.options.onError(new Error((message.payload as { message?: string })?.message ?? 'Server error'));
                    break;

                default:
                    this.log('Unknown message type', message.type);
            }
        } catch (error) {
            this.log('Failed to parse message', error);
        }
    }

    private sendMessage(message: WsMessage): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
    }

    private startPingInterval(): void {
        this.stopPingInterval();

        this.pingInterval = setInterval(() => {
            if (!this.isConnected()) return;

            if (this.pendingPong) {
                // No pong received, connection is stale
                this.log('Pong timeout, reconnecting');
                this.ws?.close(4000, 'Ping timeout');
                return;
            }

            this.pendingPong = true;
            this.sendMessage({ type: WsMessageType.PING, id: Date.now().toString() });

            // Check pong after timeout
            setTimeout(() => {
                if (this.pendingPong && this.isConnected()) {
                    this.log('Pong timeout, reconnecting');
                    this.ws?.close(4000, 'Ping timeout');
                }
            }, this.pongTimeoutMs);
        }, this.pingIntervalMs);
    }

    private stopPingInterval(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        this.pendingPong = false;
    }

    private scheduleReconnect(): void {
        if (this.isDestroyed || this.reconnectTimeout) return;

        // Exponential backoff with jitter
        const delay = Math.min(
            this.baseReconnectDelay * Math.pow(2, this.reconnectAttempt) + Math.random() * 1000,
            this.maxReconnectDelay
        );

        this.reconnectAttempt++;
        this.log(`Scheduling reconnect attempt ${this.reconnectAttempt} in ${Math.round(delay)}ms`);
        this.setState('reconnecting');

        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            this.connect();
        }, delay);
    }

    private cleanup(): void {
        this.stopPingInterval();

        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        if (this.ws) {
            this.ws.onopen = null;
            this.ws.onclose = null;
            this.ws.onerror = null;
            this.ws.onmessage = null;

            if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
                this.ws.close();
            }
            this.ws = null;
        }
    }

    private log(...args: unknown[]): void {
        if (this.options.debug) {
            console.log('[RealtimeClient]', ...args);
        }
    }
}
