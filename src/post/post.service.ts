import { PrismaService } from '@/prisma/prisma.service';
import { User } from '@generated/client';
import { BadRequestException, ForbiddenException, Injectable} from '@nestjs/common';
import { CreatePostDto } from './dto/request/create-post.dto';


@Injectable()
export class PostService {
  constructor(private prisma: PrismaService) {}

  async createPost(user: User, workspaceId: string, dto: CreatePostDto) {
    //  VALIDATE: Feature Access
    this.validateFeatures(user, dto);

    // VALIDATE: Do these profiles belong to this workspace?
    const validProfiles = await this.prisma.socialProfile.findMany({
      where: {
        id: { in: dto.socialProfileIds },
        workspaceId: workspaceId,
      },
      select: { id: true }
    });

    if (validProfiles.length !== dto.socialProfileIds.length) {
      throw new BadRequestException('One or more selected profiles do not belong to this workspace.');
    }

    // DETERMINE STATUS
    let status: 'DRAFT' | 'SCHEDULED' | 'PENDING_APPROVAL' = 'DRAFT';
    
    if (dto.needsApproval) {
      status = 'PENDING_APPROVAL';
    } else if (dto.scheduledAt || dto.isAutoSchedule) {
      status = 'SCHEDULED';
    }

    // 4. TRANSACTION: Create everything at once
    return this.prisma.$transaction(async (tx) => {
      
      // A. Create the Master Post
      const post = await tx.post.create({
        data: {
          workspaceId,
          authorId: user.id,
          content: dto.content,
          contentType: dto.contentType,
          status: status,
          scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
          isAutoSchedule: dto.isAutoSchedule,
          timezone: dto.timezone,
          campaignId: dto.campaignId,
          
          // Labels (Connect existing labels)
          labels: dto.labelIds ? {
            connect: dto.labelIds.map(id => ({ id }))
          } : undefined,
        },
      });

      // B. Link Media (Preserve Order!)
      if (dto.mediaIds && dto.mediaIds.length > 0) {
        // We map them explicitly to save the 'order' index
        const mediaData = dto.mediaIds.map((mediaId, index) => ({
          postId: post.id,
          mediaFileId: mediaId,
          order: index // 0, 1, 2... Critical for Carousels
        }));

        await tx.postMedia.createMany({ data: mediaData });
      }

      // C. Create Destinations (The "Omnichannel" part)
      // We create one entry for every profile selected (FB, IG, LinkedIn)
      const destinationData = validProfiles.map(profile => ({
        postId: post.id,
        socialProfileId: profile.id,
        status: 'SCHEDULED' as const, // Default state
      }));

      await tx.postDestination.createMany({ data: destinationData });

      // D. Handle Approval (If requested)
      if (dto.needsApproval) {
        await tx.postApproval.create({
          data: {
            postId: post.id,
            requesterId: user.id,
            status: 'PENDING',
          }
        });
      }

      // E. Return the full object
      return post;
    });
  }

  /**
   * Helper to check Pricing Limits
   */
  private validateFeatures(user: User, dto: CreatePostDto) {
    // We navigate safely in case 'features' is not flattened
    const features = user['features'] || user['organization']?.subscription?.plan?.features || {};

    // Check Approval Access
    if (dto.needsApproval && !features.approvalWorkflow) {
      throw new ForbiddenException('Upgrade to Business Plan to use Approval Workflows');
    }

    // Check Campaign Access
    if (dto.campaignId && !features.hasCampaigns) {
      throw new ForbiddenException('Upgrade to Rocket Plan to use Campaigns');
    }
  }

  // --- READ METHODS ---

  async getWorkspacePosts(workspaceId: string) {
    return this.prisma.post.findMany({
      where: { workspaceId },
      include: {
        destinations: { include: { profile: true } }, // See where it's going
        media: { include: { mediaFile: true }, orderBy: { order: 'asc' } }, // See images in order
        author: { select: { email: true, firstName: true } },
        campaign: true,
      },
      orderBy: { createdAt: 'desc' }
    });
  }
}
