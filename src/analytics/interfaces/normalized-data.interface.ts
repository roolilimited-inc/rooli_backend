export interface AccountRawData {
  platformId: string; // The external ID (e.g., LinkedIn URN)
  followersCount: number;
  impressionsCount?: number; // Some APIs give this at account level
  profileViews?: number;
  fetchedAt: Date;
}

export interface PostRawData {
  postId: string; // External ID
  impressions: number;
  likes: number;    // Normalized (Like + Love + Haha)
  comments: number; // Normalized (Comments + Replies)
  shares: number;   // Normalized (Retweets + Reposts)
  clicks?: number;
  videoViews?: number; // Standardized to 3-second views
}