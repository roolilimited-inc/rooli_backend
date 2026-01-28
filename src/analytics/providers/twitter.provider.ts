import { Injectable, Logger } from '@nestjs/common';
import { AnalyticsStrategy, PostMetrics, AccountMetrics, AnalyticsProvider, FetchAccountAnalyticsInput, FetchBatchPostAnalyticsInput, FetchPostAnalyticsInput } from '../interfaces/analytics-strategy.interface';
import { TwitterApi } from 'twitter-api-v2';
import { Platform } from '@generated/enums';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TwitterAnalyticsProvider implements AnalyticsProvider {
  platform: Platform = 'TWITTER';
  private readonly logger = new Logger(TwitterAnalyticsProvider.name);

  private readonly appKey: string;
  private readonly appSecret: string;

  constructor(private readonly config: ConfigService) {
    this.appKey = this.config.get<string>('TWITTER_API_KEY')!;
    this.appSecret = this.config.get<string>('TWITTER_API_SECRET')!;
    if (!this.appKey || !this.appSecret) {
      throw new Error('Missing TWITTER_API_KEY / TWITTER_API_SECRET');
    }
  }

  private makeClient(creds: any) {
    const accessToken = creds.accessToken;
    // THIS IS THE KEY FIX: We expect accessSecret to be passed from the service
    const accessSecret = creds.accessSecret; 

    if (!accessToken || !accessSecret) {
      // Log for debugging (don't log secrets in prod!)
      this.logger.error('Twitter OAuth1 credentials missing (accessToken or accessSecret)');
      throw new Error('Twitter OAuth1 credentials missing');
    }

    return new TwitterApi({
      appKey: this.appKey,
      appSecret: this.appSecret,
      accessToken,
      accessSecret,
    });
  }

  async fetchPostAnalytics(input: FetchPostAnalyticsInput): Promise<PostMetrics> {
    const client = this.makeClient(input.credentials);

    try {
      const { data } = await client.v2.singleTweet(input.platformPostId, {
        'tweet.fields': ['public_metrics', 'non_public_metrics', 'organic_metrics'],
      });
      return this.mapToDomain(data);
    } catch (e: any) {
       // Handle "Tweet not found" gracefully if desired
       throw e;
    }
  }

  async fetchBatchPostAnalytics(
    input: FetchBatchPostAnalyticsInput,
  ): Promise<Map<string, PostMetrics>> {
    const client = this.makeClient(input.credentials);
    const ids = input.platformPostIds.filter(Boolean);
    const result = new Map<string, PostMetrics>();

    if (!ids.length) return result;

    // Chunk size for Twitter V2 API
    const chunkSize = 100;
    
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      
      try {
        const resp = await client.v2.tweets(chunk, {
          'tweet.fields': ['public_metrics', 'non_public_metrics', 'organic_metrics'],
        });

        // Loop over successful data
        for (const tweet of resp.data ?? []) {
          result.set(tweet.id, this.mapToDomain(tweet));
        }

        // Optional: Inspect resp.errors for partial failures (deleted tweets, etc)
        if (resp.errors?.length) {
            this.logger.debug(`Batch twitter partial errors: ${resp.errors.length}`);
        }
      } catch (e: any) {
        this.logger.error(`Twitter batch chunk failed: ${e.message}`);
        // Continue to next chunk even if this one failed
      }
    }

    return result;
  }

  async fetchAccountAnalytics(input: FetchAccountAnalyticsInput): Promise<AccountMetrics> {
    const client = this.makeClient(input.credentials);

    // This fetches the user associated with the Access Token/Secret
    const { data: me } = await client.v2.me({ 
        'user.fields': ['public_metrics'] 
    });

    return {
      followersTotal: me.public_metrics?.followers_count ?? 0,
      // X API limitation: Impressions/Reach are not available at Account level via Standard API
      impressions: 0,
      reach: 0,
      profileViews: 0,
      engagementCount: 0,
      metadata: me.public_metrics ?? {},
    };
  }

  private mapToDomain(tweet: any): PostMetrics {
    // Priority: Organic metrics (if available/owned) -> Public metrics
    const organic = tweet.organic_metrics;
    const publicM = tweet.public_metrics ?? {};
    const nonPublic = tweet.non_public_metrics; // impressions usually live here for owned tweets

    return {
      likes: publicM.like_count ?? 0,
      comments: publicM.reply_count ?? 0,
      shares: (publicM.retweet_count ?? 0) + (publicM.quote_count ?? 0),
      saves: publicM.bookmark_count ?? 0,
      
      // Attempt to find impressions/views in non_public or organic metrics
      impressions: nonPublic?.impression_count ?? organic?.impression_count ?? 0,
      videoViews: publicM.view_count ?? 0, 

      clicks: organic?.url_link_clicks ?? 0, // "Clicks" usually means link clicks
      reach: 0, // Twitter doesn't typically provide "Reach" (unique people), only impressions
      
      metadata: { ...publicM, ...organic, ...nonPublic },
    };
  }
}
