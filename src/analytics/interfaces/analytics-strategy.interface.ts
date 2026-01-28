import { Platform } from "@generated/enums";

// A standardized way to return metrics, regardless of platform
export interface PostMetrics {
  likes: number;
  comments: number;
  shares: number;
  impressions: number;
  reach: number;
  clicks?: number;
  saves?: number;
  videoViews?: number;
  metadata?: any; // Store raw JSON here for debugging
}

export interface AccountMetrics {
  followersTotal: number;
  impressions?: number;
  reach?: number;
  profileViews?: number;
  engagementCount?: number;
  metadata?: any; // Store raw JSON here for debugging
}

export interface AnalyticsStrategy {
  /**
   * Fetch metrics for a SINGLE post
   */
  fetchPostMetrics(
    socialPostId: string, 
    accessToken: string,
    socialProfileId?: string
  ): Promise<PostMetrics>;

  /**
   * Fetch metrics for a LIST of posts (Platform optimization)
   * Returns a Map where Key = socialPostId, Value = Metrics
   */
  fetchBatchPostMetrics?(
    socialPostIds: string[],
    accessToken: string
  ): Promise<Map<string, PostMetrics>>;

  /**
   * Fetch Account/Page level growth
   */
  fetchAccountGrowth(
    socialProfileId: string,
    accessToken: string
  ): Promise<AccountMetrics>;
}

export type SocialCredentials = {
  platform: Platform;
  accessToken: string;
  accessSecret?: string;    // For OAuth 1.0a (Twitter)

 // Optional
  refreshToken?: string;
  expiresAt?: Date | null;
};

export type FetchPostAnalyticsInput = {
  platformPostId: string; // tweet id / fb post id / linkedin urn etc
  socialProfileId: string;
  day: Date;
  credentials: SocialCredentials;
};

export type FetchAccountAnalyticsInput = {
  socialProfileId: string;
  day: Date;
  credentials: SocialCredentials;
  metadata?: any
};

export type FetchBatchPostAnalyticsInput = {
  platformPostIds: string[];
  day: Date;
  credentials: SocialCredentials;
};


export interface AnalyticsProvider {
  platform: Platform;

  fetchPostAnalytics(input: FetchPostAnalyticsInput): Promise<PostMetrics>;

  // Optional: only implement for platforms that support batching (Twitter does)
  fetchBatchPostAnalytics?(
    input: FetchBatchPostAnalyticsInput,
  ): Promise<Map<string, PostMetrics>>;

  fetchAccountAnalytics(input: FetchAccountAnalyticsInput): Promise<AccountMetrics>;
}