import { PrismaService } from '@/prisma/prisma.service';
import { PostStatus, Prisma, User } from '@generated/client';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreatePostDto } from '../dto/request/create-post.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { UpdatePostDto } from '../dto/request/update-post.dto';
import { GetWorkspacePostsDto } from '../dto/request/get-all-posts.dto';
import { QueryMode } from '@generated/internal/prismaNamespace';
import { DestinationBuilder } from './destination-builder.service';
import { PostFactory } from './post-factory.service';
import { QueueService } from '@/queue/queue.service';
import { isBefore, subMinutes } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import { BulkCreatePostDto } from '../dto/request/bulk-schedule.dto';

@Injectable()
export class PostService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('media-ingest') private mediaIngestQueue: Queue,
    private postFactory: PostFactory,
    private destinationBuilder: DestinationBuilder,
    private queueService: QueueService,
  ) {}

async createPost(user: any, workspaceId: string, dto: CreatePostDto) {
    // 1. Validate & Resolve Metadata (Time, Status, Payloads)
    this.validateFeatures(user, dto);
    
    const { finalScheduledAt, status } = await this.resolveScheduleAndStatus(workspaceId, dto);

    const payloads = await this.destinationBuilder.preparePayloads(workspaceId, dto);

    // 2. Execute DB Transaction
    return this.prisma.$transaction(async (tx) => {
      // A) The Root Post
      const post = await this.postFactory.createMasterPost(
        tx,
        user.userId,
        workspaceId,
        { ...dto, scheduledAt: finalScheduledAt?.toISOString() },
        status,
      );

      // B) Root Destinations
      await this.destinationBuilder.saveDestinations(tx, post.id, payloads);

      // C) Materialize Threads (if applicable)
      await this.handleTwitterThreads(tx, post, payloads, dto, status);

      // D) Approval flow
      if (dto.needsApproval) {
        await this.createApproval(tx, post.id, user.id);
      }

      return post;
    });
  }
  /**
   * Helper to check Pricing Limits
   */
  private validateFeatures(user: User, dto: CreatePostDto) {
    // We navigate safely in case 'features' is not flattened
    const features =
      user['features'] ||
      user['organization']?.subscription?.plan?.features ||
      {};

    // Check Approval Access
    if (dto.needsApproval && !features.approvalWorkflow) {
      throw new ForbiddenException(
        'Upgrade to Business Plan to use Approval Workflows',
      );
    }

    // Check Campaign Access
    if (dto.campaignId && !features.hasCampaigns) {
      throw new ForbiddenException('Upgrade to Rocket Plan to use Campaigns');
    }
  }

  async getWorkspacePosts(workspaceId: string, dto: GetWorkspacePostsDto) {
    const { page, limit, status, contentType, search } = dto;

    const where = {
      workspaceId,
      ...(status && { status }),
      ...(contentType && { contentType }),
      ...(search && {
        content: { contains: search, mode: QueryMode.insensitive },
      }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.post.findMany({
        where,
        select: {
          id: true,
          workspaceId: true,
          authorId: true,
          content: true,
          contentType: true,
          status: true,
          scheduledAt: true,
          publishedAt: true,

          destinations: {
            select: {
              id: true,
              postId: true,
              contentOverride: true,
              profile: {
                select: {
                  platform: true,
                  name: true,
                  username: true,
                  picture: true,
                  type: true,
                },
              },
            },
          },
          media: {
            orderBy: { order: 'asc' },
            select: {
              id: true,
              order: true,
              mediaFile: {
                select: {
                  id: true,
                  url: true,
                  mimeType: true,
                  size: true,
                },
              },
            },
          },

          author: {
            select: {
              email: true,
              firstName: true,
            },
          },

          campaign: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),

      this.prisma.post.count({ where }),
    ]);

    const sanitizedItems = items.map((post) => ({
      ...post,
      media: post.media.map((m) => ({
        ...m,
        mediaFile: m.mediaFile
          ? {
              ...m.mediaFile,
              size: m.mediaFile.size.toString(),
            }
          : null,
      })),
    }));

    return {
      data: sanitizedItems,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
  async bulkSchedulePosts(
    user: any,
    workspaceId: string,
    dto: BulkCreatePostDto,
  ) {
    // We prepare the payloads for ALL posts first to fail fast if validation errors exist.
    const preparedPosts = [];

    for (const postDto of dto.posts) {
      // A. Basic Date Validation
      if (postDto.scheduledAt) {
        const scheduledDate = new Date(postDto.scheduledAt);
        if (scheduledDate < new Date()) {
          throw new BadRequestException(
            `Post scheduled for ${postDto.scheduledAt} is in the past.`,
          );
        }
      }

      // B. Prepare Destination Payloads
      // This handles the "Twitter Thread vs LinkedIn Post" logic automatically
      const payloads = await this.destinationBuilder.preparePayloads(
        workspaceId,
        postDto,
      );

      preparedPosts.push({ dto: postDto, payloads });
    }

    // 3. The Transaction
    // If one post fails, we roll back everything so the user can fix and retry.
    return this.prisma.$transaction(async (tx) => {
      const results = [];

      for (const item of preparedPosts) {
        const { dto: currentDto, payloads } = item;

        // A. Create Master Post
        const post = await this.postFactory.createMasterPost(
          tx,
          user.userId,
          workspaceId,
          currentDto,
          'SCHEDULED', // Bulk posts are usually implicitly approved/scheduled
        );

        // B. Save Destinations (Master)
        await this.destinationBuilder.saveDestinations(tx, post.id, payloads);

        // C. Handle Threads
        // ----------------------------------------------------
        const twitterPayloads = payloads.filter(
          (p) => p.platform === 'TWITTER',
        );

        if (twitterPayloads.length > 0 && currentDto.threads?.length > 0) {
          let previousPostId = post.id;

          for (const threadItem of currentDto.threads) {
            const threadPost = await this.postFactory.createThreadPost(
              tx,
              user.userId,
              workspaceId,
              previousPostId,
              threadItem,
              'SCHEDULED',
              post.scheduledAt,
              post.timezone,
              currentDto.campaignId,
            );

            await this.destinationBuilder.saveDestinations(
              tx,
              threadPost.id,
              twitterPayloads,
            );
            previousPostId = threadPost.id;
          }
        }

        results.push(post);
      }

      return results;
    });
  }

  async updatePost(workspaceId: string, postId: string, dto: UpdatePostDto) {
    //  Fetch the post to check permissions & status
    const post = await this.prisma.post.findFirst({
      where: { id: postId, workspaceId },
      include: { media: true },
    });

    if (!post) throw new NotFoundException('Post not found');

    // 2. STATUS CHECK: Can't edit if it's already publishing
    if (post.status === 'PUBLISHING' || post.status === 'PUBLISHED') {
      throw new BadRequestException(
        'Cannot edit a post that is published or processing.',
      );
    }

    // 3. TRANSACTION (Update content & media)
    return this.prisma.$transaction(async (tx) => {
      // A. Update Basic Fields
      const updatedPost = await tx.post.update({
        where: { id: postId },
        data: {
          content: dto.content,
          scheduledAt: dto.scheduledAt, // Changing this moves the post in the calendar
          // If the status was 'FAILED', reset it to 'SCHEDULED' or 'DRAFT'
          status: post.status === 'FAILED' ? 'DRAFT' : undefined,
        },
      });

      // B. Handle Media Updates (If provided)
      // The simplest strategy: "Wipe and Replace" for the specific post
      if (dto.mediaIds) {
        // 1. Remove old links
        await tx.postMedia.deleteMany({ where: { postId } });

        // 2. Add new links
        await tx.postMedia.createMany({
          data: dto.mediaIds.map((mid, idx) => ({
            postId,
            mediaFileId: mid,
            order: idx,
          })),
        });
      }

      // C. Special Thread Handling (If updating the ROOT post's time)
      // If you move the Root Post from 9:00 AM to 10:00 AM,
      // you must move ALL children threads to 10:00 AM too.
      if (dto.scheduledAt && post.contentType !== 'THREAD') {
        // Find all children (recursive update is hard, but 1-level deep is usually enough for threads)
        // Or better: update all posts in this "thread chain"
        // We can find them by parentPostId, or walk the tree.
        // For MVP: Just update direct children.
        await tx.post.updateMany({
          where: { parentPostId: postId },
          data: { scheduledAt: dto.scheduledAt },
        });
      }

      return updatedPost;
    });
  }

  async deletePost(workspaceId: string, postId: string) {
    const post = await this.getOne(workspaceId, postId);

    // 1. Recursive Delete Helper
    // We need to find all children, grandchildren, etc.
    // Since Prisma "NoAction" doesn't cascade automatically for self-relations sometimes,
    // we do it manually to be safe.

    const deleteIds = [postId];

    // Find children
    const children = await this.prisma.post.findMany({
      where: { parentPostId: postId },
    });
    for (const child of children) {
      deleteIds.push(child.id);
      // (If you allow deep nesting, you'd recurse here, but Twitter threads are usually flat linked lists)
      // For simplicity, we assume we delete the chain.
    }

    return this.prisma.post.deleteMany({
      where: { id: { in: deleteIds } },
    });
  }

  async getOne(workspaceId: string, postId: string) {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, workspaceId },
      select: {
        id: true,
        workspaceId: true,
        authorId: true,
        content: true,
        contentType: true,
        status: true,
        scheduledAt: true,
        publishedAt: true,
        destinations: {
          select: {
            id: true,
            postId: true,
            contentOverride: true,
            profile: {
              select: {
                platform: true,
                name: true,
                username: true,
                picture: true,
                type: true,
              },
            },
          },
        },
        media: {
          orderBy: { order: 'asc' },
          select: {
            id: true,
            order: true,
            mediaFile: {
              select: {
                id: true,
                url: true,
                mimeType: true,
                size: true,
              },
            },
          },
        },

        author: {
          select: {
            email: true,
            firstName: true,
          },
        },
        childPosts: {
          orderBy: { createdAt: 'asc' }, // Threads are usually ordered by creation
          select: {
            id: true,
            workspaceId: true,
            authorId: true,
            content: true,
            contentType: true,
            status: true,
            scheduledAt: true,
            publishedAt: true,
            destinations: {
              select: {
                id: true,
                postId: true,
                contentOverride: true,
                profile: {
                  select: {
                    platform: true,
                    name: true,
                    username: true,
                    picture: true,
                    type: true,
                  },
                },
              },
            },
            media: {
              orderBy: { order: 'asc' },
              select: {
                id: true,
                order: true,
                mediaFile: {
                  select: {
                    id: true,
                    url: true,
                    mimeType: true,
                    size: true,
                  },
                },
              },
            },

            author: {
              select: {
                email: true,
                firstName: true,
              },
            },
          },
        },

        // INCLUDE PARENT
        parentPost: true,
      },
    });

    if (!post) throw new NotFoundException('Post not found');
    return {
      ...post,
      media: post.media.map((m) => ({
        ...m,
        mediaFile: m.mediaFile
          ? {
              ...m.mediaFile,
              size: m.mediaFile.size.toString(),
            }
          : null,
      })),
      childPosts: post.childPosts.map((child) => ({
        ...child,
        media: child.media.map((m) => ({
          ...m,
          mediaFile: m.mediaFile
            ? {
                ...m.mediaFile,
                size: m.mediaFile.size.toString(),
              }
            : null,
        })),
      })),
    };
  }

  // Get all pending approvals for a workspace
  async getPendingApprovals(
    workspaceId: string,
    pagination: { page: number; limit: number },
  ) {
    const { page, limit } = pagination;

    const where = {
      post: { workspaceId },
      status: 'PENDING' as const,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.postApproval.findMany({
        where,
        include: {
          post: {
            select: {
              content: true,
              scheduledAt: true,
              contentType: true,
            },
          },
          requester: {
            select: {
              id: true,
              firstName: true,
              email: true,
            },
          },
        },
        orderBy: { requestedAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),

      this.prisma.postApproval.count({ where }),
    ]);

    return {
      data: items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // Approve or Reject (The Decision)
  async reviewApproval(
    approver: User,
    workspaceId: string,
    approvalId: string,
    status: 'APPROVED' | 'REJECTED',
    notes?: string,
  ) {
    // Fetch Approval & Verify Workspace
    const approval = await this.prisma.postApproval.findFirst({
      where: { id: approvalId, post: { workspaceId } },
      include: { post: true },
    });

    if (!approval) throw new NotFoundException('Approval request not found');
    if (approval.status !== 'PENDING')
      throw new BadRequestException('Already reviewed');

    return this.prisma.$transaction(async (tx) => {
      //Update Approval Record
      const updatedApproval = await tx.postApproval.update({
        where: { id: approvalId },
        data: {
          status,
          approverId: approver.id,
          reviewedAt: new Date(),
          notes: notes,
        },
      });

      // Update Post Status
      // If Approved -> SCHEDULED
      // If Rejected -> DRAFT (so they can edit and try again)
      await tx.post.update({
        where: { id: approval.postId },
        data: {
          status: status === 'APPROVED' ? 'SCHEDULED' : 'DRAFT',
        },
      });

      return updatedApproval;
    });
  }

  //  DELETE: Cancel a Request
  async cancelApprovalRequest(
    userId: string,
    workspaceId: string,
    approvalId: string,
  ) {
    const approval = await this.prisma.postApproval.findFirst({
      where: { id: approvalId, post: { workspaceId } },
    });

    if (!approval) throw new NotFoundException('Request not found');

    // Security: Only the requester (or an Admin) should be able to cancel
    if (approval.requesterId !== userId) {
      throw new ForbiddenException(
        'You are not authorized to cancel this request.',
      );
      // In a real app, check if user is Admin, otherwise throw Forbidden
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Delete the Approval Row
      await tx.postApproval.delete({ where: { id: approvalId } });

      // 2. Set Post back to DRAFT
      await tx.post.update({
        where: { id: approval.postId },
        data: { status: 'DRAFT' },
      });
    });
  }

  private async resolveScheduleAndStatus(workspaceId: string, dto: CreatePostDto) {
    let finalScheduledAt: Date | null = null;

    if (dto.isAutoSchedule) {
      finalScheduledAt = await this.queueService.getNextAvailableSlot(workspaceId);
    } else if (dto.scheduledAt) {
      finalScheduledAt = dto.timezone && !dto.scheduledAt.endsWith('Z')
        ? fromZonedTime(dto.scheduledAt, dto.timezone)
        : new Date(dto.scheduledAt);

      // Past date check
      if (isBefore(finalScheduledAt, subMinutes(new Date(), 5))) {
        throw new BadRequestException('Scheduled time is in the past.');
      }
    }

    const status: PostStatus = dto.needsApproval
      ? 'PENDING_APPROVAL'
      : finalScheduledAt ? 'SCHEDULED' : 'DRAFT';

    return { finalScheduledAt, status };
  }

  private async handleTwitterThreads(
    tx: Prisma.TransactionClient,
    rootPost: any,
    payloads: any[],
    dto: CreatePostDto,
    status: PostStatus
  ) {
    const twitterPayloads = payloads.filter((p) => p.platform === 'TWITTER');
    if (!twitterPayloads.length) return;

    // Validate chain consistency across profiles
    const chains = twitterPayloads
      .map((p) => p.metadata?.threadChain)
      .filter((c) => Array.isArray(c) && c.length);

    if (chains.length > 1 && chains.some(c => JSON.stringify(c) !== JSON.stringify(chains[0]))) {
      throw new BadRequestException('Twitter thread content differs across profiles.');
    }

    const chain = chains[0];
    if (!chain) return;

    // Materialize the chain
    let previousPostId = rootPost.id;
    const hasExplicitThreads = Array.isArray(dto.threads) && dto.threads.length > 0;

    for (let i = 0; i < chain.length; i++) {
      const mediaIds = hasExplicitThreads ? (dto.threads![i]?.mediaIds ?? []) : [];
      
      const threadPost = await this.postFactory.createThreadPost(
        tx,
        rootPost.authorId,
        rootPost.workspaceId,
        previousPostId,
        { content: chain[i], mediaIds },
        status,
        rootPost.scheduledAt,
        rootPost.timezone,
        rootPost.campaignId,
      );

      await this.destinationBuilder.saveDestinations(tx, threadPost.id, 
        twitterPayloads.map(p => ({ ...p, contentOverride: chain[i], metadata: Prisma.JsonNull }))
      );

      previousPostId = threadPost.id;
    }
  }

  private async createApproval(tx: Prisma.TransactionClient, postId: string, userId: string) {
    await tx.postApproval.create({
      data: { postId, requesterId: userId, status: 'PENDING' },
    });
  }
}
