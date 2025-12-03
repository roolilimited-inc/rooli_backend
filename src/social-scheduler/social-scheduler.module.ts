import { Module } from '@nestjs/common';
import { SocialSchedulerService } from './services/social-scheduler.service';
import { HttpModule } from '@nestjs/axios';
import { FacebookPlatformService } from './platforms/facebook-platform.service';
import { BullModule } from '@nestjs/bullmq';
import { SocialSchedulerController } from './social-scheduler.controller';
import { InstagramPlatformService } from './platforms/instagram-platform.service';
import { SocialPostProcessor } from './processors/social-post.processor';
import { PreparePostService } from './services/prepare-post.service';
import { EncryptionService } from '@/common/utility/encryption.service';
import { PostRepository } from './services/post-repo.service';
import { QueueService } from './services/queue.service';
import { LinkedInPlatformService } from './platforms/linkedIn-platform.service';
import { TwitterPlatformService } from './platforms/twitter-platform.service';

@Module({
  imports: [
    HttpModule.register({
      timeout: 30000,
      maxRedirects: 5,
    }),
    BullModule.registerQueue({
      name: 'social-posting',
      defaultJobOptions: {
        removeOnComplete: 50, // Keep last 50 completed jobs
        removeOnFail: 100, // Keep last 100 failed jobs for debugging
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000, // 5 seconds initial delay
        },
      },
    }),
  ],
  controllers: [SocialSchedulerController],
  providers: [
    SocialSchedulerService,
    SocialPostProcessor,
    FacebookPlatformService,
    InstagramPlatformService,
    LinkedInPlatformService,
    TwitterPlatformService,
    EncryptionService,
    PreparePostService,
    PostRepository,
    QueueService
  ],
  exports: [SocialSchedulerService],
})
export class SocialSchedulerModule {}
