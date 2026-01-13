import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { SocialFactory } from '@/social/social.factory';

//This is where the magic happens. It receives the postId, loads the data, and (for now) stubs the API call.

@Processor('publishing-queue')
export class PublishingProcessor extends WorkerHost {
  private readonly logger = new Logger(PublishingProcessor.name);

  constructor(private prisma: PrismaService, private socialFactory: SocialFactory) {
    super();
  }

  async process(job: Job<{ postId: string }>) {
    const { postId } = job.data;
    this.logger.log(`Processing Post: ${postId}`);

    // 1. Fetch Full Post Data
    // We need the content, media, AND the destinations
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: {
        media: { include: { mediaFile: true }, orderBy: { order: 'asc' } },
        destinations: { include: { profile: true } },
      },
    });

    if (!post) return; // Should not happen

   const results = await Promise.allSettled(
      post.destinations.map(async (dest) => {
        // 1. Get the correct Provider (Twitter, LinkedIn, etc.)
        const provider = this.socialFactory.getProvider(dest.profile.platform);

        // 2. Decrypt Token (Security Best Practice)
        // const token = decrypt(dest.profile.accessToken); 
        const token = dest.profile.accessToken; // Assumed plain for now

        // 3. Determine Content
        const content = dest.contentOverride || post.content;

        // 4. 🚀 REAL API CALL
        const result = await provider.publish(
          token,
          content,
          post.media.map(m => m.mediaFile), // Pass media objects
          dest.metadata // Pass thread info if needed
        );

        return { 
          destinationId: dest.id, 
          status: 'SUCCESS', 
          platformPostId: result.platformPostId 
        };
      })
    );
      

    // 3. Handle Results & Update DB
    // We need to see if "Everything Failed", "Partial Success", or "Success"
    
    let successCount = 0;
    let failCount = 0;

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const data = result.value;
        await this.prisma.postDestination.update({
          where: { id: data.destinationId },
          data: { 
            status: 'SUCCESS', 
            publishedAt: new Date(),
            platformPostId: data.platformPostId 
          }
        });
        successCount++;
      } else {
        // Handle Failure
        // In a real app, you'd find the destination ID from the rejected reason 
        // (requires nicer error handling structure)
        failCount++;
      }
    }

    // 4. Update Master Post Status
    // If at least one destination succeeded, we call it PUBLISHED (or PARTIAL)
    // If all failed, it is FAILED.
    const finalStatus = failCount === post.destinations.length ? 'FAILED' : 'PUBLISHED';

    await this.prisma.post.update({
      where: { id: postId },
      data: { status: finalStatus },
    });
    
    this.logger.log(`Finished Post ${postId}. Status: ${finalStatus}`);
  }
}