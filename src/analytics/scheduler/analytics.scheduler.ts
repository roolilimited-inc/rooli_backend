import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '@/prisma/prisma.service';
import { Platform, PlanTier } from '@generated/enums';

@Injectable()
export class AnalyticsScheduler {
  private readonly logger = new Logger(AnalyticsScheduler.name);

  constructor(
    @InjectQueue('analytics-queue') private readonly analyticsQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 🕛 DAILY CRON JOB
   * Runs every day at midnight (00:00) to fetch fresh stats.
   * Customize via CronExpression if needed.
   */
 // @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async scheduleDailyFetch() {
    this.logger.log('⏰ Starting Daily Analytics Scheduling...');

    // 1. Fetch all ACTIVE social profiles
    // We only want profiles that are connected (accessToken exists)
    // and belong to active subscriptions.
    const profiles = await this.prisma.socialProfile.findMany({
      where: {
        isActive: true,
        accessToken: { not: null },
        workspace: {
          organization: {
            isActive: true,
          },
        },
      },
      select: {
        id: true,
        platform: true,
        platformId: true,
        accessToken: true,
        workspace: {
          select: {
            id: true,
            timezone: true,
            organization: {
              select: {
                id: true,
                timezone: true,
                status: true,
                subscription: {
                  select: {
                    plan: true, // <-- your tier here
                    status: true,
                    currentPeriodEnd: true,
                  },
                },
              },
            },
          },
        },
        socialConnectionId: true,
      },
    });

    this.logger.log(`Found ${profiles.length} profiles to schedule.`);

    let scheduledCount = 0;

    for (const profile of profiles) {
      // 2. APPLY PLAN LIMITS (The "Gatekeeper")
      // Don't schedule expensive X (Twitter) fetches for Creator plans.
      if (this.shouldSkipPlatform(profile.platform, profile.workspace.organization.subscription.plan.tier)) {
        continue;
      }

      // 3. ADD TO QUEUE
      await this.analyticsQueue.add(
        'fetch-stats',
        { socialProfileId: profile.id },
        {
          // Retry Strategy: Exponential backoff handles transient API failures (429/500)
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000, // 5s, 10s, 20s...
          },
          // Important: Keep job ID unique per day to prevent duplicate scheduling
          // if Cron runs twice by accident or server restarts.
          jobId: `analytics-${profile.id}-${new Date().toISOString().split('T')[0]}`,

          // Optional: Spread jobs out over the next hour to prevent API spikes
          // delay: Math.floor(Math.random() * 3600000)
        },
      );

      scheduledCount++;
    }

    this.logger.log(`✅ Scheduled ${scheduledCount} analytics jobs.`);
  }

  /**
   * Helper: Check if this plan allows this platform
   */
  private shouldSkipPlatform(platform: Platform, plan: PlanTier): boolean {
    // Creator Plan does NOT include Twitter (X)
    if (plan === 'CREATOR' && platform === 'TWITTER') {
      return true; // Skip
    }
    return false;
  }
}
