import "./env.js";
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const httpServer = app.getHttpAdapter().getHttpServer();
  app.useWebSocketAdapter(new WsAdapter(httpServer));

  // Enable CORS for HTTP endpoints (health check)
  app.enableCors({
    origin: process.env.CORS_ORIGINS?.split(',') || true,
  });

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`Realtime Gateway is running on port ${port}`);
}
bootstrap();
