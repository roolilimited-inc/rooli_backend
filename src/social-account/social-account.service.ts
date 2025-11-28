import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateSocialAccountDto } from './dtos/create-account.dto';
import { UpdateSocialAccountDto } from './dtos/update-social-account.dto';
import { PrismaService } from '@/prisma/prisma.service';
import { SocialAccount } from '@generated/client';
import { Platform } from '@generated/enums';

@Injectable()
export class SocialAccountService {
  private readonly logger = new Logger(SocialAccountService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create or update a social account connection
   * Used after successful OAuth flow
   */
  async upsertSocialAccount(
    createDto: CreateSocialAccountDto,
  ): Promise<SocialAccount> {
    const { organizationId, platform, platformAccountId } = createDto;

    try {
      const socialAccount = await this.prisma.socialAccount.upsert({
        where: {
          platform_platformAccountId: {
            platform,
            platformAccountId,
          },
        },
        update: {
          username: createDto.username,
          name: createDto.name,
          profileImage: createDto.profilePicture,
          accessToken: createDto.accessToken,
          refreshToken: createDto.refreshToken,
          tokenExpiresAt: createDto.tokenExpiresAt,
          scopes: createDto.scopes,
          isActive: true, // Reactivate if previously disconnected
          updatedAt: new Date(),
          lastSyncAt: new Date()
        },
        create: {
          organizationId: createDto.organizationId,
          platform: createDto.platform,
          platformAccountId: createDto.platformAccountId,
          username: createDto.username,
          name: createDto.name,
          profileImage: createDto.profilePicture,
          accessToken: createDto.accessToken,
          refreshToken: createDto.refreshToken,
          tokenExpiresAt: createDto.tokenExpiresAt,
          scopes: createDto.scopes,
          isActive: true,
          lastSyncAt: new Date()
        },
      });

      this.logger.log(
        `Social account upserted: ${platform} account ${platformAccountId} for org ${organizationId}`,
      );
      return socialAccount;
    } catch (error) {
      this.logger.error(
        `Failed to upsert social account: ${error.message}`,
        error.stack,
      );
      throw new Error(`Could not save social account: ${error.message}`);
    }
  }

  /**
   * Find all active social accounts for a specific platform
   * Used by polling services
   */
  async findAllForPlatform(platform: Platform): Promise<SocialAccount[]> {
    try {
      return await this.prisma.socialAccount.findMany({
        where: {
          platform,
          isActive: true,
          accessToken: { not: null },
          // Optional: Filter out expired tokens if you have that info
          // OR tokenExpiresAt: { gt: new Date() },
        },
        orderBy: { lastSyncAt: 'asc' }, // Poll oldest first
      });
    } catch (error) {
      this.logger.error(
        `Failed to find social accounts for platform ${platform}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Could not retrieve social accounts: ${error.message}`);
    }
  }

  /**
   * Find all social accounts for an organization
   * Used for dashboard display
   */
  async findByOrganization(organizationId: string): Promise<SocialAccount[]> {
    try {
      return await this.prisma.socialAccount.findMany({
        where: {
          organizationId,
          isActive: true,
        },
        orderBy: [{ platform: 'asc' }, { username: 'asc' }],
      });
    } catch (error) {
      this.logger.error(
        `Failed to find social accounts for organization ${organizationId}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Could not retrieve social accounts: ${error.message}`);
    }
  }

  /**
   * Find a specific social account by ID
   */
  async findById(id: string): Promise<SocialAccount> {
    try {
      const account = await this.prisma.socialAccount.findUnique({
        where: { id, isActive: true },
      });

      if (!account) {
        throw new NotFoundException(`Social account with ID ${id} not found`);
      }

      return account;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Failed to find social account ${id}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Could not retrieve social account: ${error.message}`);
    }
  }

  /**
   * Find social account by platform and account ID
   * Used for webhook processing
   */
  async findByPlatformAccountId(
    platform: Platform,
    accountId: string,
  ): Promise<SocialAccount | null> {
    try {
      return await this.prisma.socialAccount.findFirst({
        where: {
          platform,
          platformAccountId: accountId,
          isActive: true,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to find social account ${platform} ${accountId}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Could not retrieve social account: ${error.message}`);
    }
  }

  /**
   * Update last polled timestamp
   * Used by polling services after successful fetch
   */
  async updateLastPolledTime(id: string): Promise<void> {
    try {
      await this.prisma.socialAccount.update({
        where: { id },
        data: { lastSyncAt: new Date() },
      });
    } catch (error) {
      this.logger.error(
        `Failed to update last polled time for account ${id}: ${error.message}`,
        error.stack,
      );
      // Don't throw - this shouldn't break the polling flow
    }
  }

  /**
   * Update last posted timestamp
   * Used after successful post publication
   */
  async updateLastPostedTime(id: string): Promise<void> {
    try {
      await this.prisma.socialAccount.update({
        where: { id },
        data: { lastPostedAt: new Date() },
      });
    } catch (error) {
      this.logger.error(
        `Failed to update last posted time for account ${id}: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Update social account details
   */
  async update(
    id: string,
    updateDto: UpdateSocialAccountDto,
  ): Promise<SocialAccount> {
    try {
      return await this.prisma.socialAccount.update({
        where: { id },
        data: updateDto,
      });
    } catch (error) {
      this.logger.error(
        `Failed to update social account ${id}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Could not update social account: ${error.message}`);
    }
  }

  /**
   * Soft delete - mark account as inactive
   */
  async disconnect(id: string): Promise<SocialAccount> {
    try {
      return await this.prisma.socialAccount.update({
        where: { id },
        data: {
          isActive: false,
          accessToken: null, // Remove sensitive data
          refreshToken: null,
          tokenExpiresAt: null,
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to disconnect social account ${id}: ${error.message}`,
        error.stack,
      );
      throw new Error(`Could not disconnect social account: ${error.message}`);
    }
  }

  /**
   * Check if an organization has reached its social account limit
   * Based on your requirement of "up to 5 team members"
   */
  async hasReachedAccountLimit(organizationId: string): Promise<boolean> {
    try {
      const activeAccountCount = await this.prisma.socialAccount.count({
        where: {
          organizationId,
          isActive: true,
        },
      });

      // Assuming a limit - adjust based on your business rules
      const MAX_ACCOUNTS_PER_ORG = 10;
      return activeAccountCount >= MAX_ACCOUNTS_PER_ORG;
    } catch (error) {
      this.logger.error(
        `Failed to check account limit for organization ${organizationId}: ${error.message}`,
        error.stack,
      );
      return true; // Fail safe - don't allow creation if we can't verify
    }
  }
}
