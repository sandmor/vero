import path from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { PrismaService } from './prisma.service.js';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController, EnvHealthIndicator } from './health.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        path.join(process.cwd(), '.env'),
      ],
    }),
    TerminusModule,
  ],
  controllers: [AppController, HealthController],
  providers: [RealtimeGateway, PrismaService, EnvHealthIndicator],
})
export class AppModule { }
