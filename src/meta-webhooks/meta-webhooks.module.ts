import { Module } from '@nestjs/common';
import { MetaWebhooksService } from './meta-webhooks.service';
import { MetaWebhooksController } from './meta-webhooks.controller';

@Module({
  controllers: [MetaWebhooksController],
  providers: [MetaWebhooksService],
})
export class MetaWebhooksModule {}
