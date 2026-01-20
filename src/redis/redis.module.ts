import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { RedisController } from './redis.controller';
import Redis from 'ioredis';

@Global()
@Module({
  providers: [
    RedisService,
    {
      provide: 'REDIS_CLIENT',
      useFactory: () => {
        const redisUrl = process.env.REDIS_URL;

        if (redisUrl) {
          console.log(`🚀 Connecting to Redis at ${redisUrl.split('@')[1]}...`);
          
          // CHECK: Does the URL strictly indicate a secure connection?
          const isTls = redisUrl.startsWith('rediss://');

          return new Redis(redisUrl, {
            // Only apply TLS options if the URL is actually secure (rediss://)
            // Render Internal URLs (redis://) do NOT support TLS.
            ...(isTls ? { tls: { rejectUnauthorized: false } } : {}),
          });
        }

        console.log('💻 Connecting to Local Redis...');
        return new Redis({
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379', 10),
        });
      },
    },
  ],
  exports: [RedisService, 'REDIS_CLIENT'],
})
export class RedisModule {}
