import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  BaseScheduledPost,
  LinkedInScheduledPost,
  MetaScheduledPost,
  TwitterScheduledPost,
} from '../interfaces/social-scheduler.interface';
import { EncryptionService } from '@/common/utility/encryption.service';
import { PrismaService } from '@/prisma/prisma.service';
import { Platform } from '@generated/enums';

@Injectable()
export class PreparePostService {
  private readonly logger = new Logger(PreparePostService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryptionService: EncryptionService,
  ) {}

  async preparePlatformPost(post: any) {
    try {
      const [mediaUrls, decryptedToken] = await Promise.all([
        this.getMediaFiles(post.mediaFileIds || []),
        this.decryptToken(post.socialAccount.accessToken, 'social account'),
      ]);

      const basePost: BaseScheduledPost = {
        id: post.id,
        content: post.content,
        mediaUrls,
        scheduledAt: post.scheduledAt,
        timezone: post.timezone,
      };

      switch (post.socialAccount.platform) {
        case Platform.META:
          return await this.prepareMetaPlatformPost(
            basePost,
            post,
            decryptedToken,
          );

        case Platform.X:
          return this.prepareTwitterPlatformPost(
            basePost,
            post
          );

        case Platform.LINKEDIN:
          return this.prepareLinkedInPlatformPost(
            basePost,
            post,
            decryptedToken,
          );

        default:
          throw new BadRequestException(
            `Unsupported platform: ${post.socialAccount.platform}`,
          );
      }
    } catch (error) {
      this.logger.error(
        `Failed to prepare platform post for post ID ${post?.id}`,
        error.stack,
      );

      if (
        error instanceof BadRequestException ||
        error instanceof UnauthorizedException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to prepare post for publishing',
      );
    }
  }

  private async prepareMetaPlatformPost(
    basePost: BaseScheduledPost,
    post: any,
    fallbackToken: string,
  ): Promise<MetaScheduledPost> {
    try {
      const targetPlatform = post.platform;
      const pageAccount = post.pageAccount;

      if (pageAccount?.accessToken) {
        const accessToken = await this.decryptToken(
          pageAccount.accessToken,
          'page account',
        );

        if (!pageAccount.platformPageId) {
          throw new BadRequestException(
            'Page account missing platform page ID',
          );
        }

        const metaPost: MetaScheduledPost = {
          ...basePost,
          platform: targetPlatform,
          accessToken,
          pageId: pageAccount.platformPageId,
          pageAccountId: pageAccount.id,
          contentType: post.contentType,
          metadata: post.metadata
        };

        if (targetPlatform === 'INSTAGRAM') {
          if (!pageAccount.instagramBusinessId) {
            throw new BadRequestException(
              'Instagram business ID required for Instagram posts',
            );
          }
          metaPost.instagramBusinessId = pageAccount.instagramBusinessId;
        }

        return metaPost;
      }

      if (!post.socialAccount.platformAccountId) {
        throw new BadRequestException(
          'Social account missing platform account ID',
        );
      }

      return {
        ...basePost,
        platform: targetPlatform,
        accessToken: fallbackToken,
        platformAccountId: post.socialAccount.platformAccountId,
        metadata: post.metadata,

      };
    } catch (error) {
      this.logger.error(
        `Failed to prepare Meta post for post ID ${post.id}`,
        error.stack,
      );
      throw error;
    }
  }

private async prepareTwitterPlatformPost(
    basePost: BaseScheduledPost,
    post: any,
    // Note: You need to fetch accessSecret here too
  ): Promise<TwitterScheduledPost> {
    
    if (!post.socialAccount.accessToken || !post.socialAccount.accessSecret) {
       throw new UnauthorizedException('Missing Twitter credentials');
    }

    const [token, secret] = await Promise.all([
       this.encryptionService.decrypt(post.socialAccount.accessToken),
       this.encryptionService.decrypt(post.socialAccount.accessSecret)
    ]);

    return {
      ...basePost,
      platform: Platform.X,
      accessToken: `${token}:${secret}`, 
      accountId: post.socialAccount.platformAccountId,
    };
  }

private prepareLinkedInPlatformPost(
    basePost: BaseScheduledPost,
    post: any,
    accessToken: string,
  ): LinkedInScheduledPost {
    
    let targetUrnOrId: string;

    if (post.pageAccountId && post.pageAccount) {
      // CASE A: Posting to a Company Page
      if (!post.pageAccount.platformPageId) {
        throw new BadRequestException('Page account missing platformPageId');
      }
      targetUrnOrId = post.pageAccount.platformPageId;
    } else {
      // CASE B: Posting to Personal Profile
      if (!post.socialAccount.platformAccountId) {
        throw new BadRequestException('Social account missing platformAccountId');
      }
      targetUrnOrId = post.socialAccount.platformAccountId;
    }

    return {
      ...basePost,
      platform: Platform.LINKEDIN,
      accessToken,
      accountId: targetUrnOrId,
    };
  }

  private async getMediaFiles(mediaIds: string[]): Promise<string[]> {
    if (!mediaIds.length) return [];

    try {
      const mediaFiles = await this.prisma.mediaFile.findMany({
        where: { id: { in: mediaIds } },
        select: { url: true },
      });

      if (mediaFiles.length !== mediaIds.length) {
        const foundIds = mediaFiles.map((f) => f.url);
        const missingCount = mediaIds.length - mediaFiles.length;
        this.logger.warn(
          `${missingCount} media file(s) not found. Requested: ${mediaIds.length}, Found: ${mediaFiles.length}`,
        );
      }

      return mediaFiles.map((f) => f.url);
    } catch (error) {
      this.logger.error(
        `Failed to fetch media files for IDs: ${mediaIds.join(', ')}`,
        error.stack,
      );
      throw new InternalServerErrorException('Failed to fetch media files');
    }
  }

  private async decryptToken(
    encryptedToken: string,
    tokenType: string,
  ): Promise<string> {
    try {
      if (!encryptedToken) {
        throw new UnauthorizedException(`Missing ${tokenType} access token`);
      }

      const decrypted = await this.encryptionService.decrypt(encryptedToken);

      if (!decrypted) {
        throw new UnauthorizedException(
          `Failed to decrypt ${tokenType} access token`,
        );
      }

      return decrypted;
    } catch (error) {
      this.logger.error(
        `Token decryption failed for ${tokenType}`,
        error.stack,
      );

      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new UnauthorizedException(`Invalid ${tokenType} access token`);
    }
  }
}
