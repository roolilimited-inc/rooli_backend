import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { startOfUtcDay } from '../analytics.util';

@Injectable()
export class AnalyticsScheduler {
  private readonly logger = new Logger(AnalyticsScheduler.name);

  constructor(@InjectQueue('analytics') private readonly queue: Queue) {}

  // Run nightly at 00:10 UTC (adjust as needed)
  @Cron('10 0 * * *', { timeZone: 'UTC' })
  async runNightly() {
    const day = startOfUtcDay(new Date()).toISOString().slice(0, 10); 
    this.logger.log(`Enqueue analytics jobs for day=${day}`);

    // 1) Account analytics first
    await this.queue.add('collect-account-analytics', { day }, { jobId: `acct:${day}` });

    // 2) Post analytics next
    await this.queue.add('collect-post-analytics', { day }, { jobId: `post:${day}` });
  }
}
