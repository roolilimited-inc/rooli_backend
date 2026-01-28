// analytics.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { AnalyticsService } from '@/analytics/analytics.service';

@Processor('analytics')
@Injectable()
export class AnalyticsJobsProcessor extends WorkerHost {
  private readonly logger = new Logger(AnalyticsJobsProcessor.name);

  constructor(private readonly analytics: AnalyticsService) {
    super();
  }

  async process(job: Job<any, any, string>) {
    const dayIso = job.data?.day as string | undefined;

    switch (job.name) {
      case 'collect-account-analytics':
        this.logger.log(`Job collect-account-analytics day=${dayIso}`);
        return this.analytics.collectAccountAnalytics(dayIso);

      case 'collect-post-analytics':
        this.logger.log(`Job collect-post-analytics day=${dayIso}`);
        return this.analytics.collectPostAnalytics(dayIso);

      default:
        this.logger.warn(`Unknown analytics job: ${job.name}`);
        return;
    }
  }
}
