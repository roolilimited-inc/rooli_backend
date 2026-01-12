import { Prisma, User } from "@generated/client";
import { PostStatus } from "@generated/enums";
import { Injectable } from "@nestjs/common";
import { CreatePostDto } from "../dto/request/create-post.dto";
import { ThreadItemDto } from "../dto/request/thread-item.dto";

@Injectable()
export class PostFactory {
  // 1. MASTER POST
  async createMasterPost(
    tx: Prisma.TransactionClient,
    user: User,
    workspaceId: string,
    dto: CreatePostDto,
    status: PostStatus,
  ) {
    const post = await tx.post.create({
      data: {
        workspaceId,
        authorId: user.id,
        content: dto.content,
        contentType: dto.contentType,
        status,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        isAutoSchedule: dto.isAutoSchedule,
        timezone: dto.timezone,
        campaignId: dto.campaignId,
        labels: dto.labelIds
          ? { connect: dto.labelIds.map((id) => ({ id })) }
          : undefined,
      },
    });

    // Move Media Logic Inside
    if (dto.mediaIds?.length) {
      await this.createPostMedia(tx, post.id, dto.mediaIds);
    }

    return post;
  }

  // 2. THREAD POST
  async createThreadPost(
    tx: Prisma.TransactionClient,
    user: User,
    workspaceId: string,
    parentPostId: string,
    threadItem: ThreadItemDto,
    status: PostStatus,
    rootScheduledAt: Date | null,
    rootTimezone: string,
    campaignId?: string,
  ) {
    const post = await tx.post.create({
      data: {
        workspaceId,
        authorId: user.id,
        content: threadItem.content,
        contentType: 'THREAD',
        status,
        scheduledAt: rootScheduledAt,
        timezone: rootTimezone,
        parentPostId,
        campaignId,
      },
    });

    // Reuse Media Logic
    if (threadItem.mediaIds?.length) {
      await this.createPostMedia(tx, post.id, threadItem.mediaIds);
    }

    return post;
  }

  // 3. PRIVATE HELPER (Don't Repeat Yourself)
  private async createPostMedia(
    tx: Prisma.TransactionClient,
    postId: string,
    mediaIds: string[],
  ) {
    await tx.postMedia.createMany({
      data: mediaIds.map((mediaId, index) => ({
        postId,
        mediaFileId: mediaId,
        order: index,
      })),
    });
  }
}