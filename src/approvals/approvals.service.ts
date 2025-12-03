import { NotificationService } from '@/notification/notification.service';
import { PrismaService } from '@/prisma/prisma.service';
import { SocialSchedulerService } from '@/social-scheduler/services/social-scheduler.service';
import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { GetApprovalsFilterDto } from './dtos/get-approval.dto';
import { Prisma } from '@generated/client';
import { PostStatus, ApprovalStatus } from '@generated/enums';

export interface PostingResult {
  success: boolean;
  platformPostId?: string;
  url?: string;
  message?: string;
  error?: string;
  metadata?: Record<string, any>;
}

interface PostMetadata {
  options?: Record<string, any>;
  [key: string]: any;
}

@Injectable()
export class ApprovalsService {
  private readonly MAX_RETRIES = 3;
  private readonly logger = new Logger(ApprovalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationService,
    private readonly schedulingService: SocialSchedulerService,
  ) {}

  async createApprovalRequest(
    postId: string,
    requesterId: string,
  ) {
    try {
      const approval = await this.prisma.postApproval.create({
        data: {
          postId,
          requesterId,
          status: 'PENDING',
        },
      });

      this.logger.log(`📝 Approval request created for post ${postId}`);
      return approval;
    } catch (error) {
      this.logger.error(
        `Failed to create approval request for post ${postId}: ${error.message}`,
        error.stack || '',
      );
      throw error;
    }
  }

  /**
   * Get a single approval by ID (with related post and users)
   */
  async getApprovalById(approvalId: string, organizationId: string) {
    const approval = await this.prisma.postApproval.findFirst({
      where: {
        id: approvalId,
        post: { organizationId },
      },
      include: {
        post: true,
        requester: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        approver: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    if (!approval) throw new NotFoundException('Approval not found');
    return approval;
  }

  /**
   * Get all approvals (with filters and pagination)
   */
  async getApprovals(organizationId: string, filters: GetApprovalsFilterDto) {
    const where: Prisma.PostApprovalWhereInput = {
      post: { organizationId },
    };

    if (filters.status) where.status = filters.status;
    if (filters.postId) where.postId = filters.postId;
    if (filters.requesterId) where.requesterId = filters.requesterId;
    if (filters.approverId) where.approverId = filters.approverId;

    const [approvals, total] = await Promise.all([
      this.prisma.postApproval.findMany({
        where,
        include: {
          post: true,
          requester: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          approver: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
        orderBy: { requestedAt: 'desc' },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.postApproval.count({ where }),
    ]);

    return {
      approvals,
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        pages: Math.ceil(total / filters.limit),
      },
    };
  }

  async approvePost(postId: string, approverId: string, comments?: string) {
    const approval = await this.updateApprovalStatus(
      postId,
      approverId,
      'APPROVED',
      comments,
    );

    // Handle post publishing/scheduling after approval
    await this.handlePostAfterApproval(postId);

    this.logger.log(`✅ Post ${postId} approved and queued for next step`);
    return approval;
  }

  async rejectPost(
    postId: string,
    approverId: string,
    comments: string,
    revisionNotes?: string,
  ) {
    this.updateApprovalStatus(
      postId,
      approverId,
      'REJECTED',
      comments,
      revisionNotes,
    );
  }

  async requestChanges(
    postId: string,
    approverId: string,
    comments: string,
    revisionNotes: string,
  ) {
    return this.updateApprovalStatus(
      postId,
      approverId,
      'CHANGES_REQUESTED',
      comments,
      revisionNotes,
    );
  }

  /**
   * Handle post workflow after approval
   */
  private async handlePostAfterApproval(postId: string): Promise<void> {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: {
        socialAccount: {
          include: {
            pages: true,
          },
        },
      },
    });

    if (!post) {
      this.logger.error(`Post ${postId} not found after approval`);
      return;
    }

    try {
      // Handle scheduling or immediate publishing
      if (
        post.scheduledAt &&
        new Date(post.scheduledAt).getTime() > Date.now()
      ) {
        await this.schedulingService.schedulePost(post.id);

        await this.prisma.post.update({
          where: { id: post.id },
          data: { status: PostStatus.SCHEDULED },
        });

        this.logger.log(
          `📅 Post ${postId} scheduled for ${post.scheduledAt}`,
        );
      } else {
        // Publish immediately
        await this.schedulingService.publishImmediately(post.id);
        this.logger.log(
          `🚀 Post ${postId} published immediately after approval`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to handle post after approval: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  private async updateApprovalStatus(
    postId: string,
    approverId: string,
    status: ApprovalStatus,
    comments?: string,
    revisionNotes?: string,
  ) {
    const approval = await this.prisma.postApproval.findUnique({
      where: { postId },
      include: { post: true, requester: true },
    });

    if (!approval) {
      throw new NotFoundException('Approval request not found');
    }

    if (approval.status !== 'PENDING') {
      throw new ForbiddenException(
        'Approval request has already been processed',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Update approval
      const updatedApproval = await tx.postApproval.update({
        where: { postId },
        data: {
          approverId,
          status,
          comments,
          revisionNotes,
          reviewedAt: new Date(),
        },
      });

      // Update post status
      let postStatus: PostStatus;
      switch (status) {
        case 'APPROVED':
          postStatus = PostStatus.APPROVED;
          break;
        case 'REJECTED':
          postStatus = PostStatus.DRAFT;
          break;
        case 'CHANGES_REQUESTED':
          postStatus = PostStatus.DRAFT;
          break;
        default:
          postStatus = PostStatus.DRAFT;
      }

      await tx.post.update({
        where: { id: postId },
        data: { status: postStatus },
      });

      // Notify requester
      // await this.notificationsService.notifyApprovalDecision(
      //   approval.requesterId,
      //   postId,
      //   status,
      //   comments,
      // );

      return updatedApproval;
    });
  }
}
