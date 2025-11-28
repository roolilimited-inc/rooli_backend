import { PrismaService } from '@/prisma/prisma.service';
import { WebhookEvent } from '@generated/client';
import { Platform } from '@generated/enums';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class WebhookProcessingService {
  private readonly logger = new Logger(WebhookProcessingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async processWebhookEvent(webhookEvent: WebhookEvent): Promise<void> {
    try {
      // 1. Save to analytics DIRECTLY (no event needed for engagements)
      if (webhookEvent.eventType !== 'MESSAGE_RECEIVED') {
        await this.processEngagement(webhookEvent);
      }

      // 2. Only emit event for MESSAGES (Inbox module)
      if (webhookEvent.eventType === 'MESSAGE_RECEIVED') {
        await this.emitMessageEvent(webhookEvent);
      }

      this.logger.log(`Processed webhook event: ${webhookEvent.id}`);
    } catch (error) {
      this.logger.error(
        `Failed to process webhook: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  private async processEngagement(webhookEvent: WebhookEvent): Promise<void> {
    // Extract post ID from payload - this will be platform-specific
    const payload = webhookEvent.payload as any;
    const postId =
      payload.entry?.[0]?.changes?.[0]?.value?.post_id ||
      payload.entry?.[0]?.id;

    if (!postId) {
      this.logger.warn(`No post ID found in webhook event ${webhookEvent.id}`);
      return;
    }

    // You need to get the socialAccountId from somewhere
    // This depends on your webhook event structure
    const socialAccount = await this.prisma.socialAccount.findFirst({
      where: {
        platform: webhookEvent.platform,
        platformAccountId: webhookEvent.platformAccountId,
      },
      select: { id: true, organizationId: true },
    });

    if (!socialAccount) {
      this.logger.warn(
        `No social account found for platformAccountId ${webhookEvent.platformAccountId}`,
      );
      return;
    }
  }

  private async emitMessageEvent(webhookEvent: WebhookEvent): Promise<void> {
    const payload = webhookEvent.payload as any;

    // Extract message data - platform-specific parsing
    const messageData = this.extractMessageData(payload, webhookEvent.platform);

    this.eventEmitter.emit('message.received', {
      platform: webhookEvent.platform,
      messageData: {
        ...messageData,
        webhookEventId: webhookEvent.id,
      },
      socialAccountId: webhookEvent.platformAccountId, // This needs to be your internal social account ID
      organizationId: webhookEvent.organizationId,
    });
  }

  private extractMessageData(payload: any, platform: Platform): any {
    // Platform-specific message extraction logic
    switch (platform) {
      case Platform.INSTAGRAM:
      case Platform.FACEBOOK:
        return {
          id: payload.entry?.[0]?.messaging?.[0]?.message?.mid,
          from: payload.entry?.[0]?.messaging?.[0]?.sender?.id,
          text: payload.entry?.[0]?.messaging?.[0]?.message?.text,
          timestamp: payload.entry?.[0]?.messaging?.[0]?.timestamp,
        };
      default:
        return payload;
    }
  }
}
