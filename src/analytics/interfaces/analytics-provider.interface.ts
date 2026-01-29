import { AccountRawData, PostRawData } from "./normalized-data.interface";



export interface IAnalyticsProvider {
  /**
   * Fetches high-level account stats (Followers, Profile Views).
   * Used for the "Health" tab.
   */
  getAccountStats(socialProfileId: string, accessToken: string): Promise<AccountRawData>;

  /**
   * Fetches performance for a batch of specific posts.
   * Used for the "Content Performance" tab.
   */
  getPostStats(postIds: string[], accessToken: string): Promise<PostRawData[]>;
}