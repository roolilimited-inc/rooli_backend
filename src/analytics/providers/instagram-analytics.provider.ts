import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import {
  AccountMetrics,
  AuthCredentials,
  IAnalyticsProvider,
  PostMetrics,
} from '../interfaces/analytics-provider.interface';

@Injectable()
export class InstagramAnalyticsProvider implements IAnalyticsProvider {
  private readonly logger = new Logger(InstagramAnalyticsProvider.name);
  private readonly baseUrl = 'https://graph.facebook.com/v22.0';

  constructor(
    private readonly config: ConfigService,
    private readonly httpService: HttpService,
  ) {}

  /**
   * INSTAGRAM ACCOUNT STATS
   * Note: We fetch the IG User ID, not the Facebook Page ID.
   */
  async getAccountStats(
    igUserId: string,
    credentials: AuthCredentials,
  ): Promise<AccountMetrics> {
    try {
      const token = credentials.accessToken
      // 1. Fetch Follower Count & Profile Views/Reach
      // Insights metrics: impressions, reach, profile_views
      const fields = 'followers_count';
      const insightsMetric = 'impressions,reach,profile_views';

      const url = `${this.baseUrl}/${igUserId}`;
      const { data } = await firstValueFrom(
        this.httpService.get(url, {
          params: {
            access_token: token,
            fields: `${fields},insights.metric(${insightsMetric}).period(day)`,
          },
        }),
      );

      const insights = data.insights?.data || [];

      const getMetric = (name: string) =>
        insights.find((i: any) => i.name === name)?.values?.[0]?.value || 0;

      return {
        platformId: igUserId,
        followersCount: data.followers_count || 0,
        impressionsCount: getMetric('impressions'),
        profileViews: getMetric('profile_views'),
        fetchedAt: new Date(),
      };
    } catch (error) {
      this.logger.error(`IG Account fetch failed for ${igUserId}`, error);
      throw error;
    }
  }

  /**
   * INSTAGRAM MEDIA STATS (BATCHED)
   * Handles Images, Videos, and Reels (if media_product_type is requested).
   */
  async getPostStats(
    mediaIds: string[],
    credentials: AuthCredentials,
  ): Promise<PostMetrics[]> {
    const token = credentials.accessToken;
    if (mediaIds.length === 0) return [];
    const chunks = this.chunkArray(mediaIds, 50);
   const results = await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const publicFields = 'id,like_count,comments_count,media_product_type,media_type';
        const insightMetrics = 'impressions,reach,saved,total_interactions';
        const url = `${this.baseUrl}/`;

        const { data } = await firstValueFrom(
          this.httpService.get(url, {
            params: {
              access_token: token,
              ids: chunk.join(','), // Only join the chunk
              fields: `${publicFields},insights.metric(${insightMetrics})`,
            },
          }),
        );

        return Object.values(data).map((media: any) => {
          const insights = media.insights?.data || [];
          const getInsight = (name: string) =>
            insights.find((i: any) => i.name === name)?.values?.[0]?.value || 0;

          return {
            postId: media.id,
            impressions: getInsight('impressions'),
            reach: getInsight('reach'),
            likes: media.like_count || 0,
            comments: media.comments_count || 0,
            shares: getInsight('saved'),
            clicks: 0,
            videoViews: media.media_type === 'VIDEO' ? getInsight('video_views') : undefined,
          };
        });
      } catch (error) {
        this.logger.error(`Instagram Chunk Failed: ${error.message}`);
        return [];
      }
    }),
  );

  return results.flat();
}

  protected chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
