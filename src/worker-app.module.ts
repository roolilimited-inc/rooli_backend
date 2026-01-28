import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './prisma/prisma.module';
import { WorkerModule } from './worker/worker.module';


@Module({
  imports: [
    // 1. CONFIGURATION (Copied from AppModule)
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    
    // 2. DATABASE (Essential for your processors)
    PrismaModule, 

    // 3. REDIS CONNECTION (Copied exactly from AppModule)
    BullModule.forRootAsync({
      useFactory: () => {
        if (process.env.REDIS_URL) {
          const url = new URL(process.env.REDIS_URL);
          const isTls = process.env.REDIS_URL.startsWith('rediss://');
          return {
            connection: {
              host: url.hostname,
              port: Number(url.port),
              username: url.username || undefined,
              password: url.password || undefined,
              ...(isTls ? { tls: { rejectUnauthorized: false } } : {}),
            },
          };
        }
        return {
          connection: {
            host: process.env.REDIS_HOST || 'localhost',
            port: Number(process.env.REDIS_PORT || 6379),
            password: process.env.REDIS_PASSWORD || undefined,
          },
        };
      },
    }),

    // 4. THE LOGIC (Your existing module)
    WorkerModule, 
  ],
})
export class WorkerAppModule {}