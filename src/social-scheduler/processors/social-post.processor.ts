import { Processor, OnWorkerEvent, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SocialSchedulerService } from '../services/social-scheduler.service';

@Processor('social-posting')
@Injectable()
export class SocialPostProcessor extends WorkerHost {
  private readonly logger = new Logger(SocialPostProcessor.name);

  constructor(
    private readonly schedulerService: SocialSchedulerService,
  ) {
    super();
    this.logger.log('🚀 SocialPostProcessor worker initialized and ready');
  }

  async process(job: Job): Promise<void> {
    const { postId, retryCount = 0, isRetry = false} = job.data;

    this.logger.log(
      `Processing ${isRetry ? 'retry' : 'job'} ${job.id} for post ${postId} (attempt: ${retryCount + 1})`,
    );


    try {
      await this.schedulerService.processScheduledPost(job.data);
    } catch (error) {
      this.logger.error(
        `Failed to process job ${job.id} for post ${postId}:`,
        error,
      );
      throw error;
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`✅ Job ${job.id} completed successfully`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error) {
    this.logger.error(`❌ Job ${job?.id} failed: ${err.message}`);
  }

  @OnWorkerEvent('stalled')
  onStalled(job: Job) {
    this.logger.warn(`Job ${job.id} stalled and will be retried`);
  }

  @OnWorkerEvent('active')
  onAdded(job: Job) {
    this.logger.debug(`Added a new job ${job.id}`);
  }

  @OnWorkerEvent('error')
  onError(err: Error) {
    this.logger.error(`Worker error: ${err.message}`);
  }

  @OnWorkerEvent('ready')
  onReady() {
    this.logger.log('🎯 Worker is ready to process jobs');
  }
}
