import { PrismaService } from '@/prisma/prisma.service';
import { Platform } from '@generated/enums';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class PollingProcessingService {
  private readonly logger = new Logger(PollingProcessingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async processPolledEngagements(
    engagements: any[],
    platform: Platform,
    socialAccountId: string,
    organizationId: string,
  ): Promise<void> {
    for (const engagement of engagements) {
      try {

        // 2. Only emit event for MESSAGES (Inbox module)
        if (engagement.type === 'message') {
          await this.emitMessageEvent(
            engagement,
            platform,
            socialAccountId,
            organizationId,
          );
        }

        this.logger.debug(`Processed ${platform} engagement: ${engagement.id}`);
      } catch (error) {
        this.logger.error(
          `Failed to process ${platform} engagement ${engagement.id}:`,
          error.stack,
        );
        // Continue processing other engagements
      }
    }
  }

  private async emitMessageEvent(
    engagement: any,
    platform: Platform,
    socialAccountId: string,
    organizationId: string,
  ): Promise<void> {
    this.eventEmitter.emit('message.received', {
      platform: platform,
      messageData: {
        id: engagement.id,
        from: engagement.from,
        text: engagement.text,
        timestamp: engagement.timestamp,
      },
      socialAccountId: socialAccountId,
      organizationId: organizationId,
    });
  }
}
