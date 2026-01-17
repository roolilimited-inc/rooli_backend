import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { SocialFactory } from '@/social/social.factory';

//This is where the magic happens. It receives the postId, loads the data, and (for now) stubs the API call.
@Processor('publishing-queue')
export class PublishingProcessor extends WorkerHost {
  private readonly logger = new Logger(PublishingProcessor.name);

  constructor(
    private prisma: PrismaService,
    private socialFactory: SocialFactory,
  ) {
    super();
  }

  /**
   * 1. ENTRY POINT
   * This simply kicks off the chain. It does NOT do the publishing itself.
   */
  async process(job: Job<{ postId: string }>) {
    const { postId } = job.data;
    this.logger.log(`Start Processing Chain for Post: ${postId}`);

    // We start the recursive chain with the Head Post.
    // parentPlatformId is undefined because the head has no parent.
    await this.processPostChain(postId);

    this.logger.log(`Finished Chain for Post: ${postId}`);
  }

  /**
   * 2. RECURSIVE LOGIC 🔄
   * Handles publishing current post -> updates DB -> calls itself for the child.
   */
  async processPostChain(postId: string, parentPlatformId?: string) {
    try {
      // A. Fetch Data
      const post = await this.prisma.post.findUnique({
        where: { id: postId },
        include: {
          media: { include: { mediaFile: true }, orderBy: { order: 'asc' } },
          destinations: {
            include: {
              profile: {
                include: { connection: true },
              },
            },
          },
          childPosts: {
            take: 1,
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (!post) {
        this.logger.warn(`Post ${postId} not found during chain processing.`);
        return;
      }

      // B. Prepare Common Data
      const mediaPayload = post.media.map((m) => ({
        url: m.mediaFile.url,
        mimeType: m.mediaFile.mimeType,
        height: m.mediaFile.height,
        width: m.mediaFile.width,
      }));

      // C. Publish to All Destinations
      // We map over destinations and return the promise so Promise.allSettled tracks them
      const results = await Promise.allSettled(
        post.destinations.map(async (dest) => {
          const provider = this.socialFactory.getProvider(
            dest.profile.platform,
          );

          const credentials = {
            accessToken:
              dest.profile.accessToken || dest.profile.connection.accessToken,
            accessSecret: dest.profile.connection.refreshToken,
          };

          const content = dest.contentOverride || post.content;

          const metadata = {
            pageId: dest.profile.platformId,
            authorUrn: dest.profile.platformId,
            replyToPostId: parentPlatformId,
          };

          // This might throw, which is caught by allSettled as 'rejected'
          const result = await provider.publish(
            credentials,
            content,
            mediaPayload,
            metadata,
          );

          return {
            destinationId: dest.id,
            platformPostId: result.platformPostId,
          };
        }),
      );

      // D. Handle Results & Update DB
      let successCount = 0;
      let failCount = 0;
      let nextParentId = parentPlatformId;

      // We loop through the RESULTS, matching them back to destinations by index if needed
      // But simpler: we just handle the outcome based on the result status
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const dest = post.destinations[i]; // 👈 Access the destination object here by index

        if (result.status === 'fulfilled') {
          // ✅ SUCCESS CASE
          const data = result.value;

          await this.prisma.postDestination.update({
            where: { id: data.destinationId },
            data: {
              status: 'SUCCESS',
              publishedAt: new Date(),
              platformPostId: data.platformPostId,
              errorMessage: null, // Clear any previous errors
            },
          });

          if (data.platformPostId) {
            nextParentId = data.platformPostId;
          }
          successCount++;
        } else {
          // ❌ FAILURE CASE
          failCount++;
          const error = result.reason; // The error thrown by provider.publish

          let errorMessage = error.message || 'Unknown error';
          let status = 'FAILED';

          // 🚨 RATE LIMIT HANDLING (Moved Here)
          // Now we have access to 'dest' and 'error'
          if (error.response?.status === 429 || error.code === 429) {
            this.logger.warn(`Rate Limit Hit for Profile ${dest.profile.name}`);
            errorMessage = 'Rate limit reached. Please try again later.';
            // You might not want to mark it FAILED permanently if you plan to retry,
            // but for now, we mark it failed with a specific message.
          }

          this.logger.error(
            `Publishing failed for ${dest.profile.platform}: ${errorMessage}`,
          );

          await this.prisma.postDestination.update({
            where: { id: dest.id },
            data: {
              status: 'FAILED', // Or 'FAILED' based on your enum
              errorMessage: errorMessage,
            },
          });
        }
      }

      // E. Update Master Post Status
      const finalStatus =
        failCount === post.destinations.length ? 'FAILED' : 'PUBLISHED';

      await this.prisma.post.update({
        where: { id: postId },
        data: { status: finalStatus, publishedAt: new Date() },
      });

      // F. 🚀 RECURSION STEP
      if (post.childPosts.length > 0 && nextParentId && successCount > 0) {
        this.logger.log(
          `Found child post. Continuing chain to ${post.childPosts[0].id}`,
        );
        await this.processPostChain(post.childPosts[0].id, nextParentId);
      }
    } catch (error) {
      // This catch block now only catches DB errors or Logic errors (bugs).
      // Provider errors are handled in the loop above.
      this.logger.error(
        `Critical System Error processing post ${postId}:`,
        error,
      );
    }
  }
}
