import { Injectable, Logger } from '@nestjs/common';
import { AnalyticsQueryDto } from '../dtos/analytics-query.dto';
import { PostAnalyticsSums } from '../analytics.types';
import { AnalyticsSummary } from '../dtos/analytics-summary.dto';
import { PlatformPerformance } from '../dtos/platform-performance.dto';
import { TimeSeriesData } from '../dtos/time-series-data.dto';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Get analytics summary for an organization */
  // async getOrganizationSummary(
  //   organizationId: string,
  //   query: AnalyticsQueryDto,
  // ): Promise<AnalyticsSummary> {
  //   const where = this.buildWhereClause(organizationId, query);

  //   const result = await this.prisma.postAnalyticsSnapshot.aggregate({
  //     where,
  //     _sum: {
  //       likes: true,
  //       comments: true,
  //       shares: true,
  //       impressions: true,
  //       clicks: true,
  //     },
  //   });

  //   const sums = this.normalizeSums(result._sum || {});

  //   return {
  //     totalLikes: sums.likes,
  //     totalComments: sums.comments,
  //     totalShares: sums.shares,
  //     totalImpressions: sums.impressions,
  //     totalClicks: sums.clicks,
  //     engagementRate: this.calculateEngagementRate(sums),
  //     clickThroughRate: this.calculateClickThroughRate(sums),
  //   };
  // }

  // /** Get platform performance */
  // async getPlatformPerformance(
  //   organizationId: string,
  //   query: AnalyticsQueryDto,
  // ): Promise<PlatformPerformance[]> {
  //   const platforms = await this.prisma.postAnalyticsSnapshot.groupBy({
  //     by: ['platform'],
  //     where: this.buildWhereClause(organizationId, query),
  //     _sum: {
  //       likes: true,
  //       comments: true,
  //       shares: true,
  //       impressions: true,
  //       clicks: true,
  //     },
  //   });

  //   const totalMetrics = await this.getOrganizationSummary(
  //     organizationId,
  //     query,
  //   );

  //   return platforms.map((p) => {
  //     const sums = this.normalizeSums(p._sum);
  //     return {
  //       platform: p.platform,
  //       metrics: {
  //         totalLikes: sums.likes,
  //         totalComments: sums.comments,
  //         totalShares: sums.shares,
  //         totalImpressions: sums.impressions,
  //         totalClicks: sums.clicks,
  //         engagementRate: this.calculateEngagementRate(sums),
  //         clickThroughRate: this.calculateClickThroughRate(sums),
  //       },
  //       percentageChange: this.calculatePlatformPercentage(sums, totalMetrics),
  //     };
  //   });
  // }

  /** Get time series data for charts */
  // async getTimeSeriesData(
  //   organizationId: string,
  //   query: AnalyticsQueryDto,
  // ): Promise<TimeSeriesData[]> {
  //   const results = await this.prisma.postAnalyticsSnapshot.groupBy({
  //     by: ['recordedAt'],
  //     where: this.buildWhereClause(organizationId, query),
  //     _sum: {
  //       likes: true,
  //       comments: true,
  //       shares: true,
  //       impressions: true,
  //       clicks: true,
  //     },
  //     orderBy: { createdAt: 'asc' },
  //   });

  //   return results.map((r) => {
  //     const sums = this.normalizeSums(r._sum);
  //     return {
  //       date: r.createdAt.toISOString().split('T')[0],
  //       metrics: {
  //         totalLikes: sums.likes,
  //         totalComments: sums.comments,
  //         totalShares: sums.shares,
  //         totalImpressions: sums.impressions,
  //         totalClicks: sums.clicks,
  //         engagementRate: this.calculateEngagementRate(sums),
  //         clickThroughRate: this.calculateClickThroughRate(sums),
  //       },
  //     };
  //   });
  // }

  /** Get top posts by metric */
  async getTopPosts(
    organizationId: string,
    query: AnalyticsQueryDto,
    metric: keyof PostAnalyticsSums = 'likes',
  ) {
    return this.prisma.postAnalyticsSnapshot.findMany({
      where: this.buildWhereClause(organizationId, query),
      orderBy: { [metric]: 'desc' },
      take: query.limit,
      include: {
        post: {
          select: {
            id: true,
            content: true,
            scheduledAt: true,
          },
        },
      },
    });
  }

  /** Build Prisma where clause */
  private buildWhereClause(organizationId: string, query: AnalyticsQueryDto) {
    return {
      organizationId,
      platform: query.platform,
      postId: query.postId,
      createdAt: {
        gte: query.startDate ? new Date(query.startDate) : undefined,
        lte: query.endDate ? new Date(query.endDate) : undefined,
      },
    };
  }

  /** Normalize Prisma _sum results */
  private normalizeSums(sums: Partial<PostAnalyticsSums>): PostAnalyticsSums {
    return {
      likes: sums.likes || 0,
      comments: sums.comments || 0,
      shares: sums.shares || 0,
      impressions: sums.impressions || 0,
      clicks: sums.clicks || 0,
      videoViews: sums.videoViews || 0,
      saves: sums.saves || 0,
    };
  }

  /** Engagement rate: (likes + comments + shares) / impressions */
  private calculateEngagementRate(sums: PostAnalyticsSums): number {
    const engagements = sums.likes + sums.comments + sums.shares;
    return sums.impressions > 0 ? engagements / sums.impressions : 0;
  }

  /** Click-through rate: clicks / impressions */
  private calculateClickThroughRate(sums: PostAnalyticsSums): number {
    return sums.impressions > 0 ? sums.clicks / sums.impressions : 0;
  }

  /** Platform percentage of total engagements */
  private calculatePlatformPercentage(
    sums: PostAnalyticsSums,
    total: AnalyticsSummary,
  ): number {
    const platformEngagements = sums.likes + sums.comments + sums.shares;
    const totalEngagements =
      total.totalLikes + total.totalComments + total.totalShares;
    return totalEngagements > 0 ? platformEngagements / totalEngagements : 0;
  }

  /** Convert period string to start date */
  private getStartDate(period: '7d' | '30d' | '90d'): Date {
    const days = parseInt(period.replace('d', ''), 10);
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date;
  }
}
