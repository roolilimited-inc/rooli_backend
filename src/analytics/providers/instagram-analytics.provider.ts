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

      const dailyUrl = `${this.baseUrl}/${igUserId}`;
      const dailyParams = {
        access_token: token,
        fields: 'followers_count,insights.metric(reach,impressions,profile_views,website_clicks).period(day)',
      };
    const [dailyRes, demographicsData] = await Promise.all([
        // Request A: Daily Data
        firstValueFrom(this.httpService.get(dailyUrl, { params: dailyParams })),
        
        // Request B: Lifetime Demographics
        this.getDemographics(igUserId, token),
      ]);

      // 3. Extract Data from Request A
      const data = dailyRes.data;
      const insights = data.insights?.data || [];

      // Helper to safely get value 
      const getMetric = (name: string) =>
        insights.find((i: any) => i.name === name)?.values?.[0]?.value || 0;

      return {
        platformId: igUserId,
        followersCount: data.followers_count || 0,
        impressionsCount: getMetric('impressions'),
        reach: getMetric('reach'),
        profileViews: getMetric('profile_views'),
        clicks: getMetric('website_clicks'),
        demographics: demographicsData, 
        fetchedAt: new Date(),
      };
    } catch (error) {
      console.log(error)
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
        const publicFields = 'id,like_count,comments_count,media_type,media_product_type';
        const insightMetrics = 'engagement,impressions,reach,saved,shares,video_views,total_interactions';
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
              shares: getInsight('shares'), 
              saves: getInsight('saved'), 
              engagement: getInsight('total_interactions'),
              clicks: 0,
              videoViews: media.media_type === 'VIDEO' || media.media_product_type === 'REELS' 
                ? getInsight('video_views') 
                : 0,
            };
          });
        } catch (error) {
          console.log(error)
          // Tip: If one chunk fails (e.g., due to a deleted post), log it but don't crash the whole job
          this.logger.error(`Instagram Chunk Failed: ${error.message}`);
          return [];
        }
      }),
    );

    return results.flat();
  }

private async getDemographics(igUserId: string, token: string) {
  try {
    const res = await firstValueFrom(
      this.httpService.get(`${this.baseUrl}/${igUserId}/insights`, {
        params: {
          access_token: token,
          metric: 'follower_demographics,audience_city,audience_country,audience_gender_age,audience_locale',
          period: 'lifetime',
        },
      }),
    );
    return res.data?.data || null;
  } catch (e) {
    return null; // Fails if <100 followers
  }
}

  protected chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
