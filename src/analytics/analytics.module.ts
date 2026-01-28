import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { SocialProviderFactory } from './providers/social-provider.factory';
import { EncryptionService } from '@/common/utility/encryption.service';
import { TwitterAnalyticsProvider } from './providers/twitter.provider';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, SocialProviderFactory, EncryptionService, TwitterAnalyticsProvider],
})
export class AnalyticsModule {}
