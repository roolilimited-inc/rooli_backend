import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import {
  AccountMetrics,
  AuthCredentials,
  IAnalyticsProvider,
  PostMetrics,
} from '../interfaces/analytics-provider.interface';
import { FacebookAnalyticsProvider } from '../providers/facebook-analytics.provider';
import { InstagramAnalyticsProvider } from '../providers/instagram-analytics.provider';
import { LinkedInAnalyticsProvider } from '../providers/linkedin.provider';
import { TwitterAnalyticsProvider } from '../providers/twitter.provider';
import { Platform } from '@generated/enums';
import { PrismaService } from '@/prisma/prisma.service';
import { EncryptionService } from '@/common/utility/encryption.service';
import { AnalyticsRepository } from './analytics.repository';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private providers: Map<Platform, IAnalyticsProvider>;

  constructor(
    private readonly linkedInProvider: LinkedInAnalyticsProvider,
    private readonly twitterProvider: TwitterAnalyticsProvider,
    private readonly facebookProvider: FacebookAnalyticsProvider,
    private readonly instagramProvider: InstagramAnalyticsProvider,
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
    private readonly repo: AnalyticsRepository,
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

    this.logger.log(
      `Fetching Account Stats for ${platform}:${externalProfileId}`,
    );

    try {
      return await provider.getAccountStats(externalProfileId, credentials);
    } catch (error) {
      this.logger.error(
        `Failed to fetch account stats for ${platform}`,
        error.stack,
      );
      throw error; // Rethrow so the Worker handles the retry
    }
  }

  /**
   * Fetch Post Performance 
   */
  async fetchPostStats(
    platform: Platform,
    externalPostIds: string[],
    credentials: AuthCredentials,
    context?: { pageId?: string }, // Extra context for platforms like LinkedIn
  ): Promise<PostMetrics[]> {
    const provider = this.getProvider(platform);

    this.logger.log(
      `Fetching Post Stats for ${platform} (${externalPostIds.length} posts)`,
    );

    try {
      return await provider.getPostStats(externalPostIds, credentials, context);
    } catch (error) {
      this.logger.error(
        `Failed to fetch post stats for ${platform}`,
        error.stack,
      );
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
      throw new BadRequestException(
        `No analytics provider implemented for platform: ${platform}`,
      );
    }
    return provider;
  }

  async testFetch(body: { profileId?: string; postDestinationId?: string }) {
    const { profileId, postDestinationId } = body;
    const results: any = {};

    let profile = null;
    let credentials: AuthCredentials | null = null;

    // --- STEP 1: RESOLVE CREDENTIALS
    if (profileId) {
      profile = await this.prisma.socialProfile.findUnique({
        where: { id: profileId },
        include: { connection: true },
      });

      if (!profile) throw new BadRequestException('Profile not found');

      const accessToken = await this.encryptionService.decrypt(
        profile.accessToken,
      );
      let accessSecret: string | undefined;

      if (profile.platform === 'TWITTER' && profile.connection?.refreshToken) {
        accessSecret = await this.encryptionService.decrypt(
          profile.connection.refreshToken,
        );
      }
      credentials = { accessToken, accessSecret };
    }

    // --- STEP 2: ACCOUNT STATS (Only if profileId is provided AND postDestinationId is NOT) ---
    // Or you can add an explicit 'fetchAccount: boolean' flag to the body
    if (profileId && !postDestinationId) {
      try {
        this.logger.debug(
          `🔍 Testing Account Fetch for ${profile.platform}...`,
        );
        results.account = await this.fetchAccountStats(
          profile.platform,
          profile.platformId,
          credentials,
        );
      } catch (e) {
        results.accountError = e.response?.data || e.message;
      }
    }

    // --- STEP 3: POST STATS (Only if postDestinationId is provided) ---
    if (postDestinationId) {
      if (!credentials || !profile) {
        throw new BadRequestException(
          'Post testing requires profileId for credentials',
        );
      }

      const post = await this.prisma.postDestination.findUnique({
        where: {
          socialProfileId: profileId,
          id: postDestinationId,
          status: 'SUCCESS',
        },
        select: { id: true, platformPostId: true },
      });

      if (!post)
        throw new BadRequestException(
          'Post destination not found or not successful',
        );

      try {
        this.logger.debug(`🔍 Testing Post Fetch for ${postDestinationId}...`);
        const context =
          profile.platform === 'LINKEDIN'
            ? { pageId: profile.platformId }
            : undefined;
        results.posts = await this.fetchPostStats(
          profile.platform,
          [post.platformPostId],
          credentials,
          context,
        );
      } catch (e) {
        this.logger.error(e);
        results.postError = e.response?.data || e.message;
      }
    }

    return results;
  }
}
