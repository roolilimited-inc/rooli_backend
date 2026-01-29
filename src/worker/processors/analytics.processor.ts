import { AuthCredentials } from '@/analytics/interfaces/analytics-provider.interface';
import { AnalyticsNormalizerService } from '@/analytics/services/analytics-normalizer.service';
import { AnalyticsRepository } from '@/analytics/services/analytics.repository';
import { AnalyticsService } from '@/analytics/services/analytics.service';
import { EncryptionService } from '@/common/utility/encryption.service';
import { PrismaService } from '@/prisma/prisma.service';
import { Platform } from '@generated/enums';
import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';


@Processor('analytics')
export class AnalyticsProcessor {
  private readonly logger = new Logger(AnalyticsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
    private readonly fetcher: AnalyticsService,
    private readonly normalizer: AnalyticsNormalizerService,
    private readonly repo: AnalyticsRepository,
  ) {}

  @Process('fetch-stats')
  async handleDailyFetch(job: Job<{ socialProfileId: string }>) {
    const { socialProfileId } = job.data;
    this.logger.log(`Starting analytics fetch for profile: ${socialProfileId}`);

    try {
      // 1. GET PROFILE & TOKENS
      const profile = await this.prisma.socialProfile.findUnique({
        where: { id: socialProfileId },
        include: { connection: true },
      });

      if (!profile || !profile.connection) {
        throw new Error(`Profile ${socialProfileId} not found or disconnected.`);
      }

      // 2. DECRYPT CREDENTIALS
      const credentials = await this.getCredentials(profile);

      // 3. FETCH ACCOUNT STATS (Followers, Views)
      this.logger.debug(`Fetching account stats for ${profile.platform}...`);
      const rawAccount = await this.fetcher.fetchAccountStats(
        profile.platform,
        profile.platformId,
        credentials,
      );

      // 4. NORMALIZE & SAVE ACCOUNT STATS
      const accountPayload = await this.normalizer.normalizeAccountStats(
        profile.id,
        rawAccount,
      );
      await this.repo.saveAccountAnalytics(accountPayload);

      // 5. PROCESS POST STATS (The "Active Window")
      await this.processPosts(profile.id, profile.platform, credentials, profile.platformId);

      this.logger.log(`Analytics fetch completed for ${socialProfileId}`);
    } catch (error) {
      this.logger.error(`Analytics job failed for ${socialProfileId}: ${error.message}`, error.stack);
      throw error; // Let BullMQ handle retries
    }
  }

  // ==========================================
  // HELPER METHODS
  // ==========================================

  /**
   * Helper to fetch active posts, batch them, and save stats
   */
  private async processPosts(
    profileId: string,
    platform: Platform,
    credentials: AuthCredentials,
    pageId?: string // Used for LinkedIn Context
  ) {
    // A. Get posts we want to track (e.g., last 30 posts)
    const postsToUpdate = await this.repo.getPostsForUpdate(profileId, 30);
    
    if (postsToUpdate.length === 0) return;

    // B. Extract External IDs
    const externalIds = postsToUpdate.map((p) => p.platformPostId);

    // C. Fetch from API (The Fetcher handles the Batching internally per provider rules)
    // Pass 'pageId' as context for LinkedIn
    const rawPosts = await this.fetcher.fetchPostStats(
      platform, 
      externalIds, 
      credentials, 
      { pageId } 
    );

    // D. Normalize & Save Loop
    for (const rawPost of rawPosts) {
      // Find the matching internal post ID
      const internalPost = postsToUpdate.find((p) => p.platformPostId === rawPost.postId);

      if (internalPost) {
        const snapshot = this.normalizer.normalizePostStats(internalPost.id, rawPost);
        await this.repo.savePostSnapshot(snapshot);
      }
    }
  }

  /**
   * Helper to handle decryption logic for different platforms
   */
  private async getCredentials(profile: any): Promise<AuthCredentials> {
    const accessToken = await this.encryptionService.decrypt(profile.accessToken);
    let accessSecret: string | undefined;

    // Twitter Specific Logic: Secret is in refresh_token field
    if (profile.platform === Platform.TWITTER) {
      if (profile.socialConnection.refreshToken) {
        accessSecret = await this.encryptionService.decrypt(profile.socialConnection.refreshToken);
      } else {
        throw new Error('Twitter Access Secret missing in refresh_token field');
      }
    }

    return { accessToken, accessSecret };
  }
}