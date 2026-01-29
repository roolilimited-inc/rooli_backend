import { Platform } from "@generated/enums";


export interface AccountMetrics {
  platformId: string;
  followersCount: number;
  impressionsCount?: number;
  profileViews?: number;
  fetchedAt: Date;
}

export interface PostMetrics {
  postId: string;
  likes: number;
  comments: number;
  shares: number;
  impressions?: number;
  reach?: number;
  clicks?: number;
  videoViews?: number;
  saves?: number; // Primarily for IG/Twitter
}

export interface IAnalyticsProvider {
  /**
   * Fetches high-level account stats (Followers, etc.)
   * @param id The platform-specific ID (Page ID, User ID, or URN)
   * @param credentials Platform specific auth (Token string or OAuth object)
   */
  getAccountStats(id: string, credentials: any): Promise<AccountMetrics>;

  /**
   * Fetches stats for a list of posts (Batched)
   * @param postIds Array of platform-specific Post IDs
   * @param credentials Platform specific auth
   * @param context Optional extra info (like pageId for LinkedIn)
   */
  getPostStats(
    postIds: string[], 
    credentials: any, 
    context?: Record<string, any>
  ): Promise<PostMetrics[]>;
}