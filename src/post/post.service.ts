import { PrismaService } from '@/prisma/prisma.service';
import { PostStatus, User } from '@generated/client';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { CreatePostDto } from './dto/request/create-post.dto';
import csv from 'csv-parser';
import { Readable } from 'stream';
import {
  BulkCsvRow,
  BulkValidationError,
  PreparedPost,
} from './interfaces/post.interface';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class PostService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('media-ingest') private mediaIngestQueue: Queue,
  ) {}

  async createPost(user: User, workspaceId: string, dto: CreatePostDto) {
    // FEATURE VALIDATION
    this.validateFeatures(user, dto);

    // PROFILE VALIDATION
    const validProfiles = await this.prisma.socialProfile.findMany({
      where: {
        id: { in: dto.socialProfileIds },
        workspaceId,
      },
      select: { id: true },
    });

    if (validProfiles.length !== dto.socialProfileIds.length) {
      throw new BadRequestException(
        'One or more selected profiles do not belong to this workspace.',
      );
    }

    // DETERMINE STATUS
    let status: 'DRAFT' | 'SCHEDULED' | 'PENDING_APPROVAL' = 'DRAFT';
    if (dto.needsApproval) {
      status = 'PENDING_APPROVAL';
    } else if (dto.scheduledAt || dto.isAutoSchedule) {
      status = 'SCHEDULED';
    }

    //TRANSACTION: MASTER POST + MEDIA + DESTINATIONS + THREADS + APPROVAL
    return this.prisma.$transaction(async (tx) => {
      // --- Master Post ---
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

          // Labels
          labels: dto.labelIds
            ? { connect: dto.labelIds.map((id) => ({ id })) }
            : undefined,
        },
      });

      // --- Media for Master ---
      if (dto.mediaIds?.length) {
        await tx.postMedia.createMany({
          data: dto.mediaIds.map((mediaId, index) => ({
            postId: post.id,
            mediaFileId: mediaId,
            order: index,
          })),
        });
      }

      // --- Destinations for Master ---
      const destinationData = validProfiles.map((profile) => ({
        postId: post.id,
        socialProfileId: profile.id,
        status: PostStatus.SCHEDULED,
      }));
      await tx.postDestination.createMany({ data: destinationData });

      // --- Approval Workflow ---
      if (dto.needsApproval) {
        await tx.postApproval.create({
          data: {
            postId: post.id,
            requesterId: user.id,
            status: 'PENDING',
          },
        });
      }

      // --- Threads (if any) ---
      if (dto.threads?.length) {
        let previousPostId = post.id;

        for (const threadItem of dto.threads) {
          const threadPost = await tx.post.create({
            data: {
              workspaceId,
              authorId: user.id,
              content: threadItem.content,
              contentType: 'THREAD',
              status,
              scheduledAt: post.scheduledAt,
              timezone: post.timezone,
              parentPostId: previousPostId,
              campaignId: dto.campaignId,
            },
          });

          // Media for Thread
          if (threadItem.mediaIds?.length) {
            await tx.postMedia.createMany({
              data: threadItem.mediaIds.map((mediaId, index) => ({
                postId: threadPost.id,
                mediaFileId: mediaId,
                order: index,
              })),
            });
          }

          // Destinations for Thread (same as master)
          const threadDestinations = validProfiles.map((profile) => ({
            postId: threadPost.id,
            socialProfileId: profile.id,
            status: PostStatus.SCHEDULED,
          }));
          await tx.postDestination.createMany({ data: threadDestinations });

          previousPostId = threadPost.id; // link next thread
        }
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

  async getWorkspacePosts(workspaceId: string) {
    return this.prisma.post.findMany({
      where: { workspaceId },
      include: {
        destinations: { include: { profile: true } }, // See where it's going
        media: { include: { mediaFile: true }, orderBy: { order: 'asc' } }, // See images in order
        author: { select: { email: true, firstName: true } },
        campaign: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async validateBulkCsv(user: any, workspaceId: string, fileBuffer: Buffer) {
    this.ensureBulkFeature(user);

    const rows = await this.parseCsv<BulkCsvRow>(fileBuffer);

    // Fetch All Profiles (For Name AND ID lookup)
    const workspaceProfiles = await this.prisma.socialProfile.findMany({
      where: { workspaceId },
      select: { id: true, name: true, platform: true },
    });

    // Create Maps for fast lookup
    const idMap = new Set(workspaceProfiles.map((p) => p.id));
    const nameMap = new Map(
      workspaceProfiles.map((p) => [p.name.toLowerCase().trim(), p.id]),
    );

    const validPosts: PreparedPost[] = [];
    const errors: BulkValidationError[] = [];

    rows.forEach((row, index) => {
      const rowNum = index + 1;
      try {
        if (!row.content) {
          throw new Error('Content is required');
        }

        if (!row.scheduled_at) {
          throw new Error('scheduled_at is required');
        }

        if (!row.profile_ids) {
          throw new Error('profile_ids is required');
        }

        const scheduledAt = new Date(row.scheduled_at);
        if (isNaN(scheduledAt.getTime())) {
          throw new Error('Invalid scheduled_at (must be ISO 8601 UTC)');
        }

        if (scheduledAt < new Date()) {
          throw new Error('Cannot schedule posts in the past');
        }

        // 2. INTELLIGENT PROFILE MATCHING
        const rawInputs =
          row.profile_ids?.split('|').map((s) => s.trim()) || [];
        const resolvedIds: string[] = [];

        for (const input of rawInputs) {
          if (idMap.has(input)) {
            // Exact ID match
            resolvedIds.push(input);
          } else if (nameMap.has(input.toLowerCase())) {
            // Name match (e.g. "Nike Facebook")
            resolvedIds.push(nameMap.get(input.toLowerCase()));
          } else {
            throw new Error(`Could not find profile: '${input}'`);
          }
        }

        if (resolvedIds.length === 0)
          throw new Error('No valid profiles found');

        validPosts.push({
          content: row.content,
          scheduledAt: new Date(row.scheduled_at),
          profileIds: resolvedIds,
          mediaUrl: row.media_url,
        });
      } catch (err) {
        errors.push({ row: rowNum, message: err.message });
      }
    });

    return { validPosts, errors };
  }

  async executeBulkSchedule(
    user: any,
    workspaceId: string,
    posts: PreparedPost[],
  ) {
    this.ensureBulkFeature(user);

    if (!posts || posts.length === 0)
      throw new BadRequestException('No posts provided');

    // ==================================================
    //  SECURITY CHECK 1: OWNERSHIP RE-VALIDATION
    // ==================================================

    // Extract all unique Profile IDs the user is trying to touch
    const requestedProfileIds = new Set<string>();
    posts.forEach((p) =>
      p.profileIds.forEach((id) => requestedProfileIds.add(id)),
    );
    const uniqueIds = Array.from(requestedProfileIds);

    // Ask DB: "Count how many of THESE IDs belong to THIS Workspace"
    const count = await this.prisma.socialProfile.count({
      where: {
        id: { in: uniqueIds },
        workspaceId: workspaceId,
      },
    });

    // If the DB found fewer profiles than requested, someone is lying (or spoofing)
    if (count !== uniqueIds.length) {
      throw new ForbiddenException(
        'Security Alert: One or more profiles do not belong to this workspace.',
      );
    }

    // ==================================================
    // SECURITY CHECK 2: TIME & CONTENT
    // ==================================================
    const now = new Date();

    // Quick in-memory loop (very fast)
    for (const post of posts) {
      const scheduledAt = new Date(post.scheduledAt);

      // Check for "Time Travel" or delayed submission
      if (scheduledAt < now) {
        throw new BadRequestException(
          'One or more posts are scheduled in the past. Please re-upload.',
        );
      }

      if (!post.content) {
        throw new BadRequestException('Content is missing in payload');
      }
    }

    // Define a list to hold jobs we need to trigger AFTER the transaction succeeds
    const backgroundJobs: { mediaId: string; workspaceId: string }[] = [];

    // SAVE TO DB
    await this.prisma.$transaction(async (tx) => {
      for (const post of posts) {
        // 1. Create Post
        const createdPost = await tx.post.create({
          data: {
            workspaceId,
            authorId: user.id,
            content: post.content,
            scheduledAt: post.scheduledAt,
            status: 'SCHEDULED', // Safe to use here
            timezone: 'UTC',
          },
        });

        // 2. Handle Media (Placeholder + Link)
        if (post.mediaUrl) {
          // A. Create the Placeholder MediaFile
          // ⚠️ Must provide ALL required fields with dummy data
          const mediaFile = await tx.mediaFile.create({
            data: {
              workspaceId,
              userId: user.id,
              url: post.mediaUrl, // The External URL

              // Dummy Metadata (Required for DB Constraint)
              filename: 'csv_import_pending',
              originalName: 'external_image',
              mimeType: 'image/jpeg',
              size: 0,
              publicId: `external_${Date.now()}_${Math.random().toString(36).substring(7)}`,
              isAIGenerated: false,
            },
          });

          // B. 🔗 LINK IT TO THE POST (Critical Step!)
          // Without this, the post doesn't know it has media
          await tx.postMedia.create({
            data: {
              postId: createdPost.id,
              mediaFileId: mediaFile.id,
              order: 0,
            },
          });

          // C. Add to our "To-Do" list (don't add to Queue yet)
          backgroundJobs.push({ mediaId: mediaFile.id, workspaceId });
        }

        // 3. Create Destinations
        await tx.postDestination.createMany({
          data: post.profileIds.map((profileId) => ({
            postId: createdPost.id,
            socialProfileId: profileId,
            status: 'SCHEDULED',
          })),
        });
      }
    });

    // 🚀 4. TRIGGER BACKGROUND JOBS (Safe Zone)
    // We only reach here if the transaction committed successfully
    if (backgroundJobs.length > 0) {
      // Use Promise.all to fire them rapidly
      await Promise.all(
        backgroundJobs.map((job) => this.mediaIngestQueue.add('ingest', job)),
      );
    }
  }

  private ensureBulkFeature(user: any) {
    const features =
      user['features'] || user['organization']?.subscription?.plan?.features;

    if (!features?.bulkScheduling) {
      throw new ForbiddenException(
        'Bulk scheduling is a Business Plan feature.',
      );
    }
  }

  private async parseCsv<T>(buffer: Buffer): Promise<T[]> {
    const results: T[] = [];
    const stream = Readable.from(buffer);

    return new Promise((resolve, reject) => {
      stream
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', () => resolve(results))
        .on('error', reject);
    });
  }
}
