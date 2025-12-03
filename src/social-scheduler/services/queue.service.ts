import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { JobData, Queue } from 'bullmq';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(@InjectQueue('social-posting') private readonly queue: Queue) {}

  async queueJob(
    post: any,
    delay: number,
  ) {
    const jobData = {
      postId: post.id,
      platform: post.platform,
    };

    return this.queue.add(`post-${post.id}`, jobData, {
      delay,
      removeOnComplete: true,
      removeOnFail: false,
    });
  }

  async removeJob(postId: string, jobId?: string): Promise<boolean> {
    try {
      if (jobId) {
        const job = await this.queue.getJob(jobId);
        if (job) {
          await job.remove();
          this.logger.log(` Removed BullMQ Job ID: ${jobId}`);
          return true;
        } else {
          this.logger.warn(`BullMQ Job ${jobId} not found (might have already run)`);
        }
      }
    }catch (error) {
      this.logger.error(`Failed to remove BullMQ job for post ${postId}`, error);
      return false;
    }
  }
}
