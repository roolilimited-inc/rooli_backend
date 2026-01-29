import { Injectable, Logger, BadRequestException } from "@nestjs/common";
import { AccountMetrics, AuthCredentials, IAnalyticsProvider, PostMetrics } from "../interfaces/analytics-provider.interface";
import { FacebookAnalyticsProvider } from "../providers/facebook-analytics.provider";
import { InstagramAnalyticsProvider } from "../providers/instagram-analytics.provider";
import { LinkedInAnalyticsProvider } from "../providers/linkedin.provider";
import { TwitterAnalyticsProvider } from "../providers/twitter.provider";
import { Platform } from "@generated/enums";



@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private providers: Map<Platform, IAnalyticsProvider>;

  constructor(
    private readonly linkedInProvider:LinkedInAnalyticsProvider,
    private readonly twitterProvider: TwitterAnalyticsProvider,
    private readonly facebookProvider: FacebookAnalyticsProvider,
    private readonly instagramProvider: InstagramAnalyticsProvider,
  ) {
    // Strategy Pattern: Map Enum to Service Instance
    this.providers = new Map<Platform, IAnalyticsProvider>([
      ['LINKEDIN', linkedInProvider],
      ['TWITTER', twitterProvider], // Or 'X' depending on your Enum
      ['FACEBOOK', facebookProvider],
      ['INSTAGRAM', instagramProvider],
    ]);
  }

  /**
   * Fetch Account Health (Followers, Views)
   */
  async fetchAccountStats(
    platform: Platform,
    externalProfileId: string,
    credentials: AuthCredentials,
  ): Promise<AccountMetrics> {
    const provider = this.getProvider(platform);
    
    this.logger.log(`Fetching Account Stats for ${platform}:${externalProfileId}`);
    
    try {
      return await provider.getAccountStats(externalProfileId, credentials);
    } catch (error) {
      this.logger.error(`Failed to fetch account stats for ${platform}`, error.stack);
      throw error; // Rethrow so the Worker handles the retry
    }
  }

  /**
   * Fetch Post Performance (Likes, Shares, etc.)
   */
  async fetchPostStats(
    platform: Platform,
    externalPostIds: string[],
    credentials: AuthCredentials,
    context?: { pageId?: string } // Extra context for platforms like LinkedIn
  ): Promise<PostMetrics[]> {
    const provider = this.getProvider(platform);

    this.logger.log(`Fetching Post Stats for ${platform} (${externalPostIds.length} posts)`);

    try {
      return await provider.getPostStats(externalPostIds, credentials, context);
    } catch (error) {
      this.logger.error(`Failed to fetch post stats for ${platform}`, error.stack);
      // Return empty array on failure so we don't crash the whole job? 
      // Better to throw if it's a critical network error, but for partials, providers handle it.
      throw error;
    }
  }

  /**
   * Helper: Get the correct provider or throw error
   */
  private getProvider(platform: Platform): IAnalyticsProvider {
    const provider = this.providers.get(platform);
    if (!provider) {
      throw new BadRequestException(`No analytics provider implemented for platform: ${platform}`);
    }
    return provider;
  }
}
