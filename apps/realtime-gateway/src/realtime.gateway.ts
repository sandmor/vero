import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import * as ws_1 from 'ws';
import { IncomingMessage } from 'http';
import { verifyToken } from '@clerk/backend';
import { ConfigService } from '@nestjs/config';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import { Client } from 'pg';
import { CHAT_NOTIFICATION_CHANNEL } from '@virid/db';
import { PrismaService } from './prisma.service.js';

@WebSocketGateway({ path: '/ws' })
export class RealtimeGateway
  implements
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnGatewayInit,
    OnModuleDestroy
{
  @WebSocketServer()
  server: ws_1.Server;

  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly clients = new Map<ws_1.WebSocket, string>(); // ws -> userId
  private pgClient: Client | null = null;
  private isConnecting = false;

  constructor(
    private configService: ConfigService,
    private prismaService: PrismaService
  ) {}

  async afterInit() {
    await this.connectToPostgres();
  }

  async connectToPostgres() {
    if (this.isConnecting) return;
    this.isConnecting = true;

    const connectionString =
      this.configService.get<string>('DATABASE_URL_UNPOOLED') ??
      this.prismaService.connectionString;
    if (!connectionString) {
      this.logger.error('DATABASE_URL_UNPOOLED or DATABASE_URL is not defined');
      this.isConnecting = false;
      return;
    }

    // Close existing if any
    if (this.pgClient) {
      try {
        await this.pgClient.end();
      } catch {}
    }

    this.pgClient = new Client({ connectionString });

    this.pgClient.on('notification', (msg) => {
      if (msg.channel === CHAT_NOTIFICATION_CHANNEL && msg.payload) {
        this.handleNotification(msg.payload);
      }
    });

    this.pgClient.on('error', (err) => {
      this.logger.error('PostgreSQL client error', err);
      this.pgClient = null;
      setTimeout(() => {
        this.isConnecting = false;
        this.connectToPostgres();
      }, 5000);
    });

    try {
      await this.pgClient.connect();
      await this.pgClient.query(`LISTEN ${CHAT_NOTIFICATION_CHANNEL}`);
      this.logger.log(
        `Listening to PostgreSQL notifications on "${CHAT_NOTIFICATION_CHANNEL}"`
      );
      this.isConnecting = false;
    } catch (err) {
      this.logger.error('Failed to connect to PostgreSQL', err);
      this.pgClient = null;
      setTimeout(() => {
        this.isConnecting = false;
        this.connectToPostgres();
      }, 5000);
    }
  }

  handleNotification(payloadStr: string) {
    try {
      // payloadStr might be double encoded if coming from our db helper which does manually stringify
      // But the helper says: `SELECT pg_notify(..., 'jsonString')`.
      // Postgres delivers the string as is.
      const payload = JSON.parse(payloadStr);

      if (!payload.userId) return;

      const message = JSON.stringify({
        type: 'chat_changed',
        payload: payload,
      });

      // Find clients for this user
      this.clients.forEach((userId, ws) => {
        if (
          userId === payload.userId &&
          ws.readyState === ws_1.WebSocket.OPEN
        ) {
          ws.send(message);
        }
      });
    } catch (e) {
      this.logger.error('Error parsing notification payload', e);
    }
  }

  async handleConnection(client: ws_1.WebSocket, request: IncomingMessage) {
    // Auth - extracting token from query
    const url = new URL(request.url || '', 'http://localhost');
    const token = url.searchParams.get('token');

    if (!token) {
      this.logger.warn('Client connected without token');
      client.close(4001, 'Unauthorized');
      return;
    }

    try {
      const secretKey = this.configService.get<string>('CLERK_SECRET_KEY');
      if (!secretKey) {
        this.logger.error('CLERK_SECRET_KEY is not configured');
        client.close(1011, 'Server error');
        return;
      }

      const verified = await verifyToken(token, {
        secretKey,
      });

      const userId = verified.sub;
      this.clients.set(client, userId);

      client.send(
        JSON.stringify({
          type: 'subscribed',
          payload: { userId },
        })
      );

      this.logger.log(`Client connected: ${userId}`);

      client.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'ping') {
            client.send(
              JSON.stringify({
                type: 'pong',
                id: msg.id,
              })
            );
          }
        } catch {}
      });

      client.on('error', (err) => {
        this.logger.error(`Client error (${userId})`, err);
      });
    } catch (err) {
      this.logger.warn(`Token verification failed: ${(err as Error).message}`);
      client.close(4001, 'Unauthorized');
    }
  }

  handleDisconnect(client: ws_1.WebSocket) {
    const userId = this.clients.get(client);
    if (userId) {
      this.logger.log(`Client disconnected: ${userId}`);
      this.clients.delete(client);
    }
  }

  async onModuleDestroy() {
    if (this.pgClient) {
      try {
        await this.pgClient.end();
      } catch (err) {
        this.logger.warn('Error while closing PostgreSQL client', err as Error);
      } finally {
        this.pgClient = null;
      }
    }
  }
}
