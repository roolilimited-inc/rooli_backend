import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePostDto } from './dto/create-post.dto';
import { PostFilterDto } from './dto/post-filter.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { parseISO, isBefore } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import { firstValueFrom } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import {
  PostMetadata,
  FacebookApiResponse,
  InstagramApiResponse,
} from './interfaces/index.interface';
import { ApprovalsService, PostingResult } from '@/approvals/approvals.service';
import { EncryptionService } from '@/common/utility/encryption.service';
import { MediaService } from '@/media/media.service';
import { Prisma } from '@generated/client';
import { PostStatus, Platform } from '@generated/enums';

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);
  private readonly MAX_RETRIES = 3;
  private readonly FACEBOOK_API_VERSION = 'v23.0';
  private readonly FACEBOOK_API_BASE_URL = 'https://graph.facebook.com';

  constructor(
    private readonly prisma: PrismaService,
    private readonly approvalsService: ApprovalsService,
    private readonly mediaService: MediaService,
    private readonly encryptionService: EncryptionService,
    private readonly http: HttpService,
  ) {}

  /**
   * Create a new post
   */
async createPost(organizationId: string, userId: string, dto: CreatePostDto) {
  return this.prisma.$transaction(async (tx) => {
    // 1. Validate inputs and access (your existing validation)
    await this.validatePostCreation(organizationId, userId, dto);

    // 1b. Optionally validate that the mediaFileIds exist and belong to the organization
    const mediaFileIds = dto.mediaFileIds ?? [];
    if (mediaFileIds.length > 0) {
      const found = await tx.mediaFile.findMany({
        where: {
          id: { in: mediaFileIds },
          organizationId,
        },
        select: { id: true },
      });

      const foundIds = new Set(found.map((m) => m.id));
      const missing = mediaFileIds.filter((id) => !foundIds.has(id));
      if (missing.length > 0) {
        throw new BadRequestException(`Media files not found or not in organization: ${missing.join(',')}`);
      }
    }

    // 2. Determine if this is a profile post or page post
    const isProfilePost = !dto.pageAccountId;

    // 3. Build nested connect object for media relation (only when present)
    const mediaRelation =
      mediaFileIds.length > 0
        ? { connect: mediaFileIds.map((id) => ({ id })) }
        : undefined;

    // 4. Create post as DRAFT
    const post = await tx.post.create({
      data: {
        organizationId,
        authorId: userId,
        socialAccountId: dto.socialAccountId,
        pageAccountId: dto.pageAccountId ?? null,
        content: dto.content,
        // Use nested connect for the relation field (Prisma expects an object)
        ...(mediaRelation ? { mediaFileIds: mediaRelation } : {}),
        status: PostStatus.DRAFT,
        timezone: dto.timezone,
        scheduledAt: dto.scheduledAt ?? null,
        platform: dto.platform,
        // extra metadata helper:
        // ensure postType/contentType are set inside metadata
        metadata: {
          ...(dto.metadata || {}),
          postType: isProfilePost ? 'PROFILE' : 'PAGE',
        } as Prisma.JsonValue,
      },
      include: this.getPostIncludes(),
    });

    this.logger.log(`💾 Post ${post.id} created as draft`);

    return post;
  });
}
  /**
   * Submit a draft post for approval workflow
   */
  async submitForApproval(
    postId: string,
    organizationId: string,
    userId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Validate post
      const post = await tx.post.findFirst({
        where: {
          id: postId,
          organizationId,
          status: PostStatus.DRAFT,
        },
      });

      if (!post) {
        throw new NotFoundException(
          'Draft post not found or already submitted',
        );
      }

      // 2. Create approval request record
      await this.approvalsService.createApprovalRequest(postId, userId);

      // 3. Update post status to PENDING_APPROVAL
      const updatedPost = await tx.post.update({
        where: { id: postId },
        data: { status: PostStatus.PENDING_APPROVAL },
      });

      // 4. Optionally notify approvers
      // await this.notificationsService.notifyApprovers(organizationId, postId);

      this.logger.log(`📋 Draft post ${postId} submitted for approval`);

      return updatedPost;
    });
  }

  /**
   * Get organization posts with filters and pagination
   */
  async getOrganizationPosts(organizationId: string, filters: PostFilterDto) {
    const where = this.buildPostWhereClause(organizationId, filters);

    const [posts, total] = await Promise.all([
      this.prisma.post.findMany({
        where,
        include: this.getPostIncludes(),
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.post.count({ where }),
    ]);

    return {
      posts,
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        pages: Math.ceil(total / filters.limit),
      },
    };
  }

  /**
   * Delete a post (only drafts and failed posts)
   */
  async deletePost(postId: string, organizationId: string): Promise<void> {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, organizationId },
      select: { status: true, jobId: true },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (
      !(
        [
          PostStatus.DRAFT,
          PostStatus.FAILED,
          PostStatus.CANCELED,
        ] as readonly PostStatus[]
      ).includes(post.status)
    ) {
      throw new BadRequestException(
        `Cannot delete post with status ${post.status}`,
      );
    }

    // Note: Job cancellation would now be handled by ApprovalsService
    // if it scheduled the post

    await this.prisma.post.delete({ where: { id: postId } });
    this.logger.log(`🗑️ Deleted post ${postId}`);
  }

  /** Get a single post by ID with details */
  async getPostById(postId: string, organizationId: string) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, organizationId },
      include: this.getPostIncludes(),
    });

    if (!post) throw new NotFoundException('Post not found');
    return post;
  }

  /**
   * Update a post (only drafts or failed posts)
   */
async updatePost(postId: string, organizationId: string, dto: UpdatePostDto) {
  // fetch post and include media relation so TS knows about it
  const post = await this.prisma.post.findFirst({
    where: { id: postId, organizationId },
    include: {
      mediaFileIds: { select: { id: true } }, // include relation to access existing media ids
    },
  });

  if (!post) throw new NotFoundException('Post not found');

  const EDITABLE_STATUSES: PostStatus[] = [
    PostStatus.DRAFT,
    PostStatus.FAILED,
    PostStatus.PENDING_APPROVAL,
  ];

  if (!EDITABLE_STATUSES.includes(post.status)) {
    throw new BadRequestException(`Cannot update post with status ${post.status}`);
  }

  // scheduledAt validation
  if (dto.scheduledAt) {
    const scheduled = new Date(dto.scheduledAt);
    if (isNaN(scheduled.getTime())) {
      throw new BadRequestException('Invalid scheduledAt date');
    }
    if (scheduled <= new Date()) {
      throw new BadRequestException('Scheduled time must be in the future');
    }
  }

  // validate media files if provided
  if (dto.mediaFileIds?.length) {
    await this.validateMediaFiles(dto.mediaFileIds, organizationId);
  }

  // build update payload
  const updateData: Prisma.PostUpdateInput = {
    content: dto.content ?? undefined,
    scheduledAt: dto.scheduledAt ?? undefined,
    updatedAt: new Date(), 
  };

  if (dto.mediaFileIds) {
    updateData.mediaFileIds = {
      set: dto.mediaFileIds.map((id) => ({ id })),
    };
  }

  // perform update and return requested includes
  const updated = await this.prisma.post.update({
    where: { id: postId },
    data: updateData,
    include: this.getPostIncludes(),
  });

  this.logger.log(`📝 Post ${postId} updated successfully`);
  return updated;
}


  // ========== ORCHESTRATION METHODS ==========
 
  /**
   * Validate post creation inputs
   */
  private async validatePostCreation(
    organizationId: string,
    userId: string,
    dto: CreatePostDto,
  ): Promise<void> {
    console.log(
      `Validating post creation for org ${organizationId}, user ${userId}`,
    );
    // Verify social account
    const socialAccount = await this.prisma.socialAccount.findFirst({
      where: {
        id: dto.socialAccountId,
        organizationId,
        isActive: true,
      },
      include: {
        pages: true,
      },
    });

    if (!socialAccount) {
      throw new ForbiddenException('Social account not found or inactive');
    }

    const platformMismatch =
      socialAccount.platform === 'META'
        ? !['FACEBOOK', 'INSTAGRAM'].includes(dto.platform)
        : dto.platform !== socialAccount.platform;

    if (platformMismatch) {
      throw new BadRequestException(
        `Platform mismatch: expected ${socialAccount.platform}, got ${dto.platform}`,
      );
    }

    // NEW: Page account validation
    let pageAccount = null;

    if (dto.pageAccountId) {
      // This is a PAGE post - validate the page account
      pageAccount = socialAccount.pages.find(
        (page) => page.id === dto.pageAccountId,
      );

      if (!pageAccount) {
        throw new BadRequestException(
          'Page not found or not associated with this social account',
        );
      }

      // Additional validation for LinkedIn pages
      if (
        socialAccount.platform === 'LINKEDIN' &&
        socialAccount.accountType !== 'PAGE'
      ) {
        throw new BadRequestException(
          'Cannot post to LinkedIn pages using a profile account',
        );
      }
    } else {
      // This is a PROFILE post - validate account type
      if (
        socialAccount.platform === 'LINKEDIN' &&
        socialAccount.accountType !== 'PROFILE'
      ) {
        throw new BadRequestException(
          'Cannot create profile post using a pages account. Please select a specific page.',
        );
      }
    }

    /**
     * ✅ Validate scheduled time (must be future)
     * dto.scheduledAt is a string like "2025-10-19T16:50:00"
     * dto.timezone is e.g. "Africa/Lagos"
     */
    if (dto.scheduledAt) {
      const localDate = parseISO(dto.scheduledAt); // convert string to Date (interpreted as local)
      const now = new Date();

      // Convert the "local" time to actual UTC timestamp for comparison
      const utcDate = fromZonedTime(localDate, dto.timezone);

      if (isBefore(utcDate, now)) {
        throw new BadRequestException('Scheduled time must be in the future.');
      }
    }

    // Validate media files
    if (dto.mediaFileIds?.length > 0) {
      await this.validateMediaFiles(dto.mediaFileIds, organizationId);
    }
  }

  /**
   * Validate media files belong to organization
   */
  private async validateMediaFiles(
    mediaFileIds: string[],
    organizationId: string,
  ): Promise<void> {
    const validationResults = await Promise.all(
      mediaFileIds.map(async (fileId) => {
        try {
          const file = await this.mediaService.getFileById(
            fileId,
            organizationId,
          );
          return !!file;
        } catch {
          return false;
        }
      }),
    );

    const allValid = validationResults.every((valid) => valid);
    if (!allValid) {
      throw new ForbiddenException(
        'One or more media files not found or access denied',
      );
    }
  }

  /**
   * Mark post as successfully published
   */
  private async markPostAsPublished(
    postId: string,
    platformPostId?: string,
  ): Promise<void> {
    await this.prisma.post.update({
      where: { id: postId },
      data: {
        status: PostStatus.PUBLISHED,
        publishedAt: new Date(),
        queueStatus: 'PUBLISHED',
        errorMessage: null,
        retryCount: 0,
        jobId: null,
      },
    });

    this.logger.log(`✅ Post ${postId} published successfully`);
  }

  /**
   * Mark post as failed with retry logic
   */
  private async markPostAsFailed(
    postId: string,
    errorMessage?: string,
  ): Promise<void> {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { retryCount: true, maxRetries: true, status: true },
    });

    if (!post) {
      this.logger.warn(`Post ${postId} not found when marking as failed`);
      return;
    }

    const maxRetries = post.maxRetries || this.MAX_RETRIES;
    const newRetryCount = (post.retryCount || 0) + 1;
    const shouldRetry = newRetryCount < maxRetries;

    await this.prisma.post.update({
      where: { id: postId },
      data: {
        status: shouldRetry ? PostStatus.FAILED : PostStatus.FAILED,
        queueStatus: shouldRetry ? 'RETRYING' : 'FAILED',
        errorMessage: errorMessage?.substring(0, 1000),
        retryCount: newRetryCount,
      },
    });

    const status = shouldRetry ? 'RETRYING' : 'FAILED';
    this.logger.warn(
      `❌ Post ${postId} marked as ${status} (attempt ${newRetryCount}/${maxRetries}): ${errorMessage}`,
    );
  }

  /**
   * Get post with social account details
   */
  private async getPostWithAccount(organizationId: string, postId: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId, organizationId },
      include: {
        socialAccount: {
          select: {
            id: true,
            platform: true,
            platformAccountId: true,
            isActive: true,
          },
        },
      },
    });

    if (!post) {
      throw new NotFoundException(`Post ${postId} not found`);
    }

    if (!post.socialAccount) {
      throw new BadRequestException(
        `Post ${postId} has no associated social account`,
      );
    }

    if (!post.socialAccount.isActive) {
      throw new BadRequestException(
        `Social account for post ${postId} is inactive`,
      );
    }

    return post;
  }

  /**
   * Build WHERE clause for post filtering
   */
  private buildPostWhereClause(
    organizationId: string,
    filters: PostFilterDto,
  ): Prisma.PostWhereInput {
    const where: Prisma.PostWhereInput = { organizationId };

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.platform) {
      where.socialAccount = { platform: filters.platform };
    }

    if (filters.startDate || filters.endDate) {
      where.scheduledAt = {};
      if (filters.startDate) {
        where.scheduledAt.gte = filters.startDate.toISOString();
      }
      if (filters.endDate) {
        where.scheduledAt.lte = filters.endDate.toISOString();
      }
    }

    if (filters.authorId) {
      where.authorId = filters.authorId;
    }

    return where;
  }
  /**
   * Standard post includes for queries
   */
  private getPostIncludes() {
    return {
      socialAccount: {
        select: {
          id: true,
          platform: true,
          username: true,
          isActive: true,
        },
      },
      author: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          avatar: true,
        },
      },
      approvals: {
        include: {
          approver: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      },
    };
  }

  async getEngagementByPlatformId(platform: Platform, postId: string) {
    const { pageAccount, platformPostId } =
      await this.getPageAccountAndPostId(postId);

    const token = await this.encryptionService.decrypt(pageAccount.accessToken);

    return this.fetchPlatformEngagement(platform, platformPostId, token);
  }

  private buildFacebookUrl(postId: string): string {
    return `${this.FACEBOOK_API_BASE_URL}/${this.FACEBOOK_API_VERSION}/${encodeURIComponent(postId)}`;
  }

  private handleApiError(error: any, platform: Platform): Error {
    this.logger.error(`${platform} API error:`, error);

    if (error.response?.status === 400) {
      return new BadRequestException(
        `Invalid ${platform} post ID or parameters`,
      );
    }

    if (error.response?.status === 401) {
      return new UnauthorizedException(`Invalid ${platform} access token`);
    }

    if (error.response?.status === 404) {
      return new NotFoundException(`${platform} post not found`);
    }

    if (error.code === 'ECONNABORTED' || error.response?.status >= 500) {
      return new BadRequestException(
        `${platform} API is temporarily unavailable`,
      );
    }

    return new BadRequestException(
      `Failed to fetch ${platform} engagement data`,
    );
  }

  private async getPageAccountAndPostId(postId: string): Promise<{
    pageAccount: any;
    platformPostId: string;
  }> {
    try {
      const post = await this.prisma.post.findUnique({
        where: { id: postId },
        select: {
          platformPostId: true,
          socialAccount: {
            select: {
              platform: true,
              pages: {
                select: {
                  id: true,
                  accessToken: true,
                },
                take: 1,
              },
            },
          },
        },
      });

      if (!post) {
        throw new NotFoundException(`Post not found: ${postId}`);
      }

      if (!post.socialAccount?.pages?.length) {
        throw new NotFoundException(
          'No active page account associated with this post',
        );
      }

      const pageAccount = post.socialAccount.pages[0];

      if (!pageAccount.accessToken) {
        throw new InternalServerErrorException(
          'Page account does not have a valid access token',
        );
      }

      if (!post.platformPostId) {
        throw new InternalServerErrorException(
          'Post does not have a platformPostId',
        );
      }

      return {
        pageAccount: {
          id: pageAccount.id,
          accessToken: pageAccount.accessToken,
          platform: post.socialAccount.platform,
        },
        platformPostId: post.platformPostId,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(
        `Failed to get page account for post ${postId}:`,
        error,
      );
      throw new InternalServerErrorException(
        'Failed to retrieve post information',
      );
    }
  }

  private async fetchPlatformEngagement(
    platform: Platform,
    platformPostId: string,
    accessToken: string,
  ) {
    const platformHandlers = {
      [Platform.FACEBOOK]: () =>
        this.fetchFacebookPostCounts(platformPostId, accessToken),
      [Platform.INSTAGRAM]: () =>
        this.fetchInstagramMediaCounts(platformPostId, accessToken),
    };

    const handler = platformHandlers[platform];
    if (!handler) {
      throw new BadRequestException(`Unsupported platform: ${platform}`);
    }

    try {
      return await handler();
    } catch (error) {
      this.logger.error(
        `Failed to fetch ${platform} engagement for post ${platformPostId}:`,
        error,
      );
      throw this.handleApiError(error, platform);
    }
  }

  private async fetchFacebookPostCounts(postId: string, accessToken: string) {
    const url = this.buildFacebookUrl(postId);
    const params = {
      fields: 'likes.summary(true).limit(0),comments.summary(true).limit(0)',
      access_token: accessToken,
    };

    this.logger.debug(`Fetching Facebook engagement for post: ${postId}`);

    try {
      const { data } = await firstValueFrom(
        this.http.get<FacebookApiResponse>(url, {
          params,
          timeout: 10000,
        }),
      );
      this.logger.debug(
        `Facebook engagement data retrieved for post: ${postId}`,
      );
      return {
        platform: Platform.FACEBOOK,
        postId: postId,
        likeCount: data?.likes?.summary?.total_count ?? 0,
        commentCount: data?.comments?.summary?.total_count ?? 0,
        retrievedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Facebook API call failed for post ${postId}:`, {
        url,
        error: error.response?.data?.error || error.message,
      });
      throw error;
    }
  }

  private async fetchInstagramMediaCounts(postId: string, accessToken: string) {
    const url = this.buildFacebookUrl(postId);
    const params = {
      fields: 'like_count,comments_count',
      access_token: accessToken,
    };

    this.logger.debug(`Fetching Instagram engagement for post: ${postId}`);

    try {
      const { data } = await firstValueFrom(
        this.http.get<InstagramApiResponse>(url, {
          params,
          timeout: 10000,
        }),
      );
      this.logger.debug(
        `Instagram engagement data retrieved for post: ${postId}`,
      );

      return {
        platform: Platform.INSTAGRAM,
        postId: postId,
        likeCount: data?.like_count ?? 0,
        commentCount: data?.comments_count ?? 0,
        retrievedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Instagram API call failed for post ${postId}:`, {
        url,
        error: error.response?.data?.error || error.message,
      });
      throw error;
    }
  }
}
