import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { AccountMetrics, AuthCredentials, IAnalyticsProvider, PostMetrics } from '../interfaces/analytics-provider.interface';

@Injectable()
export class FacebookAnalyticsProvider implements IAnalyticsProvider {
  private readonly logger = new Logger(FacebookAnalyticsProvider.name);
  private readonly baseUrl = 'https://graph.facebook.com/v22.0';
  private readonly BATCH_LIMIT = 50;

  constructor(private readonly config: ConfigService, private readonly httpService: HttpService) {}

  /**
   * PAGE STATS
   * Fetches total followers and page-level impressions/views.
   */
  async getAccountStats(
    pageId: string,
    credentials: AuthCredentials,
  ): Promise<AccountMetrics> {
    try {
      const token = credentials.accessToken
      // 1. Fetch Public Fields (Fan Count) & Insights (Impressions/Views)
      // Note: 'page_impressions' and 'page_views_total' are usually 28-day aggregates or daily
      const fields = 'fan_count,followers_count';
      const insightsMetric = 'page_impressions,page_views_total';

      const url = `${this.baseUrl}/${pageId}`;
     const { data } = await firstValueFrom(
        this.httpService.get(url, {
          params: {
            access_token: token,
            fields: `${fields},insights.metric(${insightsMetric}).period(day).limit(1)`,
          },
        })
      );

      const insights = data.insights?.data || [];

      // Helper to find metric value
      const getMetric = (name: string) =>
        insights.find((i: any) => i.name === name)?.values?.[0]?.value || 0;

      return {
        platformId: pageId,
        followersCount: data.followers_count || data.fan_count || 0,
        impressionsCount: getMetric('page_impressions'),
        profileViews: getMetric('page_views_total'),
        fetchedAt: new Date(),
      };
    } catch (error) {
      this.handleError(error, 'Facebook Page Stats', pageId);
    }
  }

  /**
   * POST STATS (BATCHED)
   * Fetches public metrics (Likes/Comments) + Private Insights (Impressions/Reach)
   * Limit: 50 IDs per batch
   */
  async getPostStats(postIds: string[], credentials: AuthCredentials): Promise<PostMetrics[]> {
    const token = credentials.accessToken;
  if (postIds.length === 0) return [];

  const chunks = this.chunkArray(postIds, this.BATCH_LIMIT);
  
  // Use Promise.all to run chunks in parallel
  const results = await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const publicFields = 'id,shares,comments.summary(true).limit(0),reactions.summary(true).limit(0)';
        const insightMetrics = 'post_impressions,post_impressions_unique,post_clicks';

        const url = `${this.baseUrl}/`;

        const { data } = await firstValueFrom(
          this.httpService.get(url, {
            params: {
              access_token: token,
              ids: chunk.join(','), // FIX: Use 'chunk', not 'postIds'
              fields: `${publicFields},insights.metric(${insightMetrics})`,
            },
          }),
        );

        // Normalize each post in this chunk
        return Object.values(data).map((post: any) => this.mapPostData(post));
      } catch (error) {
        this.logger.error(`Facebook Batch Fetch failed for chunk: ${error.message}`);
        return []; // Return empty array so .flat() handles it gracefully
      }
    }),
  );

  return results.flat();
}

  private handleError(error: any, context: string, id: string) {
    this.logger.error(
      `[${context}] Failed for ${id}: ${error.response?.data?.error?.message || error.message}`,
    );
    throw error;
  }

  protected chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

private mapPostData(post: any): PostMetrics {
    const insights = post.insights?.data || [];
    const getInsight = (name: string) => insights.find((i: any) => i.name === name)?.values?.[0]?.value || 0;

    return {
      postId: post.id,
      impressions: getInsight('post_impressions'),
      reach: getInsight('post_impressions_unique'),
      likes: post.reactions?.summary?.total_count || 0,
      comments: post.comments?.summary?.total_count || 0,
      shares: post.shares?.count || 0,
      clicks: getInsight('post_clicks'),
    };
  }
}
