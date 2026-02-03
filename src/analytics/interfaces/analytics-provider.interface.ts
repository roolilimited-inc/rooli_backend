export interface AccountMetrics {
  platformId: string;
  followersCount: number;
  impressionsCount?: number;
  reach?:number,
  profileViews?: number;
  fetchedAt: Date;
  engagementCount?: number; 
  clicks?: number;
  demographics?: any;
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

export interface AuthCredentials {
  accessToken: string;
  accessSecret?: string; 
}

export interface IAnalyticsProvider {
  /**
   * Fetches high-level account stats (Followers, etc.)
   * @param id The platform-specific ID (Page ID, User ID, or URN)
   * @param credentials Platform specific auth (Token string or OAuth object)
   */
  getAccountStats(id: string, credentials: AuthCredentials): Promise<AccountMetrics>;

  /**
   * Fetches stats for a list of posts (Batched)
   * @param postIds Array of platform-specific Post IDs
   * @param credentials Platform specific auth
   * @param context Optional extra info (like pageId for LinkedIn)
   */
  getPostStats(
    postIds: string[], 
    credentials: AuthCredentials, 
    context?: Record<string, any>
  ): Promise<PostMetrics[]>;
}

export const LINKEDIN_MAPS: Record<string, Record<string, string>> = {
  seniority: {
    'urn:li:seniority:1': 'Unpaid',
    'urn:li:seniority:2': 'Training',
    'urn:li:seniority:3': 'Entry Level',
    'urn:li:seniority:4': 'Senior',
    'urn:li:seniority:5': 'Manager',
    'urn:li:seniority:6': 'Director',
    'urn:li:seniority:7': 'VP',
    'urn:li:seniority:8': 'CXO',
    'urn:li:seniority:9': 'Partner',
    'urn:li:seniority:10': 'Owner',
  },
  // Add other maps (function, industry) as needed
};