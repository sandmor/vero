import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient, prisma } from '@virid/db';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
    private readonly clientInstance: PrismaClient;
    private readonly databaseUrl: string;

    constructor() {
        const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

        if (!connectionString) {
            throw new Error('Neither DATABASE_URL_UNPOOLED nor DATABASE_URL is defined');
        }

        this.databaseUrl = connectionString;
        this.clientInstance = prisma;
    }

    async onModuleInit() {
        await this.clientInstance.$connect();
    }

    async onModuleDestroy() {
        await this.clientInstance.$disconnect();
    }

    get client() {
        return this.clientInstance;
    }

    get connectionString() {
        return this.databaseUrl;
    }
}