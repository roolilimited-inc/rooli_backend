import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { EncryptionService } from '@/common/utility/encryption.service';
import { TwitterAnalyticsProvider } from './providers/twitter.provider';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService,  EncryptionService, TwitterAnalyticsProvider],
})
export class AnalyticsModule {}
