import { Injectable, Logger } from '@nestjs/common';

import { TwitterApi } from 'twitter-api-v2';
import { Platform } from '@generated/enums';
import { ConfigService } from '@nestjs/config';
import { AccountMetrics, IAnalyticsProvider, PostMetrics } from '../interfaces/analytics-provider.interface';

@Injectable()
export class TwitterAnalyticsProvider implements IAnalyticsProvider {
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

  async getPostStats(
    postIds: string[], 
    credentials: any
  ): Promise<PostMetrics[]> {
    if (!postIds.length) return [];
    
    const client = this.makeClient(credentials);
    const results: PostMetrics[] = [];

    // Twitter allows batching up to 100 IDs
    const chunks = this.chunkArray(postIds, 100);
    
    for (const chunk of chunks) {
      try {
        const resp = await client.v2.tweets(chunk, {
          'tweet.fields': ['public_metrics', 'non_public_metrics', 'organic_metrics'],
        });

        const mapped = (resp.data ?? []).map(tweet => this.mapToDomain(tweet));
        results.push(...mapped);
      } catch (e: any) {
        this.logger.error(`Twitter batch chunk failed: ${e.message}`);
      }
    }

    return results;
  }
  async getAccountStats(userId: string, credentials: any): Promise<AccountMetrics> {
    const client = this.makeClient(credentials);

    // This fetches the user associated with the Access Token/Secret
    const { data: user } = await client.v2.me({ 
        'user.fields': ['public_metrics'] 
    });

    return {
      platformId: user.id,
      followersCount: user.public_metrics?.followers_count ?? 0,
      // Account-level impressions are not available via standard X API
      impressionsCount: undefined, 
      profileViews: undefined,
      fetchedAt: new Date(),
    };
  }

  
  private mapToDomain(tweet: any): PostMetrics {
    const publicM = tweet.public_metrics ?? {};
    const organic = tweet.organic_metrics;
    const nonPublic = tweet.non_public_metrics;

    return {
      postId: tweet.id,
      likes: publicM.like_count ?? 0,
      comments: publicM.reply_count ?? 0,
      // X doesn't have a single "share" field; it's Retweets + Quotes
      shares: (publicM.retweet_count ?? 0) + (publicM.quote_count ?? 0),
      saves: publicM.bookmark_count ?? 0,
      
      // Impressions usually require "User Context" (OAuth 1.0a)
      impressions: nonPublic?.impression_count ?? organic?.impression_count ?? 0,
      reach: undefined, // X does not provide unique reach for organic posts
      clicks: organic?.url_link_clicks ?? 0,
      videoViews: publicM.view_count ?? 0,
    };
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
