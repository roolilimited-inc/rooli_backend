import { Injectable, NotFoundException } from '@nestjs/common';
import { ERROR_MESSAGES } from '../constants/scheduler.constants';
import { UpdatePostStatus } from '../interfaces/social-scheduler.interface';
import { PrismaService } from '@/prisma/prisma.service';
import { PostStatus, ScheduleJobStatus } from '@generated/enums';

@Injectable()
export class PostRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(postId: string, organizationId?: string): Promise<any> {
    const where: any = { id: postId };
    if (organizationId) where.organizationId = organizationId;

    const post = await this.prisma.post.findFirst({
      where,
      include: {
        socialAccount: {
          include: { pages: true },
        },
        childPosts: { 
           orderBy: { createdAt: 'asc' }, // Ensure thread order
           include: { mediaFileIds: true }
        },
      },
    });

    if (!post) {
      throw new NotFoundException(ERROR_MESSAGES.POST_NOT_FOUND(postId));
    }

    return post;
  }

  async updatePostStatus(data: UpdatePostStatus): Promise<void> {
    const { postId, status, queueStatus, metadata } = data;

    await this.prisma.$transaction(async (tx) => {
      const post = await this.findById(postId);

      const currentMeta = this.extractMetadata(post.metadata);
      const mergedMetadata = {
        ...currentMeta,
        ...this.extractMetadata(metadata),
      };

      await tx.post.update({
        where: { id: postId },
        data: {
          status,
          queueStatus,
          metadata: mergedMetadata,
        },
      });
    });
  }

  async updateInstagramScheduledPost(
    postId: string,
    jobId: string,
    containerId: string,
  ): Promise<void> {
    const existingPost = await this.prisma.post.findUnique({
      where: { id: postId },
    });

    await this.prisma.post.update({
      where: { id: postId },
      data: {
        jobId,
        status: PostStatus.SCHEDULED,
        queueStatus: ScheduleJobStatus.QUEUED,
        metadata: {
          ...this.extractMetadata(existingPost.metadata),
          containerId,
        },
      },
    });
  }

  async updateFacebookScheduledPost(
    postId: string,
    platformPostId: string,
  ): Promise<void> {
    await this.findById(postId);
    await this.prisma.post.update({
      where: { id: postId },
      data: {
        jobId: platformPostId,
        platformPostId,
        status: PostStatus.SCHEDULED,
        queueStatus: ScheduleJobStatus.SCHEDULED,
      },
    });
  }

  async updateBullMQScheduledPost(
    postId: string,
    jobId: string,
    targetPlatform: 'FACEBOOK' | 'INSTAGRAM',
  ): Promise<void> {
    const existingPost = await this.prisma.post.findUnique({
      where: { id: postId },
    });

    await this.prisma.post.update({
      where: { id: postId },
      data: {
        jobId,
        status: PostStatus.SCHEDULED,
        queueStatus: ScheduleJobStatus.QUEUED,
        metadata: {
          ...this.extractMetadata(existingPost.metadata),
          schedulingMethod: 'BULLMQ',
          targetPlatform,
        },
      },
    });
  }

  async updatePublishedPost(post: any, result: any): Promise<void> {
    await this.prisma.post.update({
      where: { id: post.id },
      data: {
        status: PostStatus.PUBLISHED,
        publishedAt: new Date(),
        platformPostId: result.platformPostId,
        jobId: result.platformPostId,
        queueStatus: ScheduleJobStatus.PUBLISHED,
      },
    });
  }

  async markPostAsPublished(
    postId: string,
    platformPostId: string,
  ): Promise<void> {
    await this.prisma.post.update({
      where: { id: postId },
      data: {
        status: PostStatus.PUBLISHED,
        publishedAt: new Date(),
        platformPostId,
        queueStatus: ScheduleJobStatus.PUBLISHED,
      },
    });
  }

  async markPostAsCancelled(postId: string): Promise<void> {
    await this.prisma.post.update({
      where: { id: postId },
      data: {
        status: PostStatus.CANCELED,
        queueStatus: ScheduleJobStatus.CANCELLED,
      },
    });
  }

  private extractMetadata(metadata: any): Record<string, any> {
    return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, any>)
      : {};
  }
}
