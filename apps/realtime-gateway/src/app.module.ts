import path from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { PrismaService } from './prisma.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        path.join(process.cwd(), '.env'),
      ],
    }),
  ],
  controllers: [AppController],
  providers: [RealtimeGateway, PrismaService],
})
export class AppModule { }
