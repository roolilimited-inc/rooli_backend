import { Prisma } from '@generated/client';
import { Injectable, Logger } from '@nestjs/common';
import { AccountMetrics, PostMetrics } from '../interfaces/analytics-provider.interface';
import { AnalyticsRepository } from './analytics.repository';


@Injectable()
export class AnalyticsNormalizerService {
  private readonly logger = new Logger(AnalyticsNormalizerService.name);

  constructor(private readonly analyticsRepository: AnalyticsRepository) {}

  /**
   * Step 1: Calculate "Growth" (Today - Yesterday)
   * Prepares the payload for the 'AccountAnalytics' table.
   */
  async normalizeAccountStats(
    internalSocialProfileId: string, // The UUID from your DB
    rawData: AccountMetrics,
  ): Promise<Prisma.AccountAnalyticsUncheckedCreateInput> {
    
    // 1. Get the LAST snapshot to compare against
    const previousSnapshot = await this.analyticsRepository.getLastAccountSnapshot(internalSocialProfileId);

    // 2. Calculate Growth
    const growth = this.calculateDelta(
      rawData.followersCount, 
      previousSnapshot?.followersTotal
    );

    // 3. Return DB Object
    return {
      socialProfileId: internalSocialProfileId,
      date: new Date(), // Today
      
      // -- Growth Metrics --
      followersTotal: rawData.followersCount,
      followersGained: growth.gained,
      followersLost: growth.lost,

      // -- Reach Metrics --
      impressions: rawData.impressionsCount || 0,
      profileViews: rawData.profileViews || 0,
      
      // Note: "Reach" (Unique People) is often hard to get at Account Level daily.
      // Default to 0 if API returns undefined.
      reach: 0, 
      websiteClicks: 0, 

      // -- Engagement --
      // Summing up engagement is usually done via Post Aggregation, 
      // but if the API gives a total "Interactions" count, use it here.
      engagementCount: 0, 
    };
  }

  /**
   * Step 2: Prepare Post Snapshot
   * Prepares payload for 'PostAnalyticsSnapshot' table.
   * NOTE: We store CUMULATIVE totals. We do NOT subtract yesterday's likes here.
   * This ensures data integrity. Subtracting happens at Read-Time (Dashboard).
   */
  normalizePostStats(
    internalPostDestinationId: string, // The UUID of the post in your DB
    rawData: PostMetrics,
  ): Prisma.PostAnalyticsSnapshotUncheckedCreateInput {
    
    return {
      postDestinationId: internalPostDestinationId,
      day: new Date(), // Today

      // -- Standard Metrics --
      likes: rawData.likes,
      comments: rawData.comments,
      shares: rawData.shares,
      impressions: rawData.impressions,
      
      // -- Advanced Metrics --
      reach: rawData.reach || 0,
      clicks: rawData.clicks || 0,
      saves: rawData.saves || 0,       // Mapped from IG 'saved' / X 'bookmarks'
      videoViews: rawData.videoViews || 0,

      // -- Debugging --
      // Store the raw dump in case we missed a metric and need to backfill later
      metadata: rawData as unknown as Prisma.InputJsonValue,
    };
  }

  /**
   * Helper: Calculates the difference between two numbers safely.
   */
  private calculateDelta(current: number, previous?: number | null) {
    // If no previous history (first fetch), we assume 0 growth to avoid massive spikes.
    // Or you can set 'gained' to 0.
    if (previous === undefined || previous === null) {
      return { gained: 0, lost: 0 };
    }

    const diff = current - previous;

    return {
      gained: diff > 0 ? diff : 0,
      lost: diff < 0 ? Math.abs(diff) : 0,
    };
  }
}