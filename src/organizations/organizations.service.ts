import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateOrganizationDto } from './dtos/create-organization.dto';
import { UpdateOrganizationDto } from './dtos/update-organization.dto';
import { OrganizationUsageDto } from './dtos/organization-usage.dto';
import { OrganizationStatsDto } from './dtos/organization-stats.dto';
import { GetAllOrganizationsDto } from './dtos/get-organiations.dto';
import { GetOrganizationMediaDto } from './dtos/get-organization-media.dto';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async createOrganization(userId: string, dto: CreateOrganizationDto) {
    try {
      // Check if slug is available
      const existing = await this.prisma.organization.findUnique({
        where: { slug: dto.slug },
      });

      if (existing) {
        throw new ConflictException('Organization slug already exists');
      }

      // Create organization and make user the owner
      return await this.prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({
          data: {
            name: dto.name,
            slug: dto.slug,
            timezone: dto.timezone || 'UTC',
            email: dto.email,
            planTier: 'FREE',
            planStatus: 'ACTIVE',
            maxMembers: 5, // Default limit
            monthlyCreditLimit: 1000, // Default credits
          },
        });

        const ownerRole = await tx.role.findFirst({
          where: { name: 'owner' },
        });

        if (!ownerRole) {
          throw new Error(
            "Role 'owner' does not exist. Seed your roles table first.",
          );
        }

        // Add user as owner
        await tx.organizationMember.create({
          data: {
            organizationId: organization.id,
            userId: userId,
            roleId: ownerRole.id,
            invitedBy: userId,
          },
        });

        // Create default brand kit
        await tx.brandKit.create({
          data: {
            organizationId: organization.id,
            name: 'Our Brand',
          },
        });

        return organization;
      });
    } catch (err) {
      console.log(err);
      throw err;
    }
  }

  async getOrganization(orgId: string) {
    const membership = await this.prisma.organizationMember.findFirst({
      where: {
        organizationId: orgId,
        isActive: true,
      },
      include: {
        organization: {
          include: {
            _count: {
              select: {
                members: { where: { isActive: true } },
                posts: true,
                aiContentGenerations: true,
                aiImageGenerations: true,
              },
            },
          },
        },
      },
    });

    if (!membership) {
      throw new NotFoundException('Organization not found or access denied');
    }

    return membership.organization;
  }

  async getAllOrganizations(dto: GetAllOrganizationsDto) {
    const { name, isActive, planTier, planStatus, page, limit } = dto;

    // Calculate pagination offsets
    const skip = (page - 1) * limit;
    const take = limit;

    const where: any = {};

    if (name) where.name = { contains: name, mode: 'insensitive' };
    if (isActive !== undefined) where.isActive = isActive;
    if (planTier) where.planTier = planTier;
    if (planStatus) where.planStatus = planStatus;

    const organizations = await this.prisma.organization.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
    });

    return organizations;
  }

  async updateOrganization(
    orgId: string,
    userId: string,
    dto: UpdateOrganizationDto,
  ) {
    return this.prisma.organization.update({
      where: { id: orgId },
      data: {
        ...dto,
        updatedAt: new Date(),
      },
    });
  }

  async deleteOrganization(orgId: string, userId: string) {
    // Soft delete organization and related data
    return this.prisma.$transaction(async (tx) => {
      // Deactivate organization
      await tx.organization.update({
        where: { id: orgId },
        data: { isActive: false },
      });

      // Deactivate all members
      await tx.organizationMember.updateMany({
        where: { organizationId: orgId },
        data: { isActive: false },
      });

      // Cancel any active subscriptions
      //await this.cancelSubscription(orgId);

      return { success: true, message: 'Organization deleted successfully' };
    });
  }

  async getOrganizationUsage(
    orgId: string,
    userId: string,
  ): Promise<OrganizationUsageDto> {
    await this.verifyMembership(orgId, userId);

    const [organization, memberCount, creditUsage, postCount, mediaStorage] =
      await Promise.all([
        this.prisma.organization.findUnique({ where: { id: orgId } }),
        this.prisma.organizationMember.count({
          where: { organizationId: orgId, isActive: true },
        }),
        this.prisma.aIUsage.aggregate({
          where: { organizationId: orgId },
          _sum: { tokensUsed: true },
        }),
        this.prisma.post.count({ where: { organizationId: orgId } }),
        this.prisma.mediaFile.aggregate({
          where: { organizationId: orgId },
          _sum: { size: true },
        }),
      ]);

    return {
      memberCount,
      creditUsage: creditUsage._sum.tokensUsed || 0,
      postCount,
      mediaStorage: mediaStorage._sum.size || 0,
      maxMembers: organization.maxMembers,
      monthlyCreditLimit: organization.monthlyCreditLimit,
    };
  }

  async getOrganizationStats(
    orgId: string,
    userId: string,
  ): Promise<OrganizationStatsDto> {
    await this.verifyMembership(orgId, userId);

    const stats = await this.prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        _count: {
          select: {
            members: { where: { isActive: true } },
            posts: true,
            aiContentGenerations: true,
            aiImageGenerations: true,
          },
        },
        posts: {
          select: {
            analytics: {
              select: {
                likes: true,
                comments: true,
                shares: true,
                impressions: true,
              },
            },
          },
        },
      },
    });

    const totalEngagement = stats.posts.reduce((sum, post) => {
      const postEngagement = post.analytics.reduce(
        (acc, a) => acc + (a.likes + a.comments + a.shares),
        0,
      );
      return sum + postEngagement;
    }, 0);

    const totalImpressions = stats.posts.reduce((sum, post) => {
      const postImpressions = post.analytics.reduce(
        (acc, a) => acc + a.impressions,
        0,
      );
      return sum + postImpressions;
    }, 0);

    const engagementRate =
      totalImpressions > 0 ? (totalEngagement / totalImpressions) * 100 : 0;

    return {
      totalPosts: stats._count.posts,
      scheduledPosts: 0, // You'd need to track this separately
      aiGenerations:
        stats._count.aiContentGenerations + stats._count.aiImageGenerations,
      teamMembers: stats._count.members,
      engagementRate: parseFloat(engagementRate.toFixed(2)),
    };
  }

  async checkMemberLimit(orgId: string): Promise<boolean> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { maxMembers: true },
    });

    const memberCount = await this.prisma.organizationMember.count({
      where: { organizationId: orgId, isActive: true },
    });

    return memberCount < organization.maxMembers;
  }

  async getAllOrganizationMedia(
    organizationId: string,
    query: GetOrganizationMediaDto,
  ) {
    const { page = 1, limit = 20, type, search } = query;
    const skip = (page - 1) * limit;

    const where: any = { organizationId };

    if (type) where.mimeType = { startsWith: type }; // e.g. "image" or "video"
    if (search) where.originalName = { contains: search, mode: 'insensitive' };

    const [data, total] = await Promise.all([
      this.prisma.mediaFile.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.mediaFile.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // private async verifyOwnership(orgId: string, userId: string) {
  //   let ownerRole = await this.prisma.role.findUnique({
  //     where: { name: 'OWNER' },
  //   });

  //   const membership = await this.prisma.organizationMember.findFirst({
  //     where: {
  //       organizationId: orgId,
  //       userId: userId,
  //       roleId: ownerRole.id,
  //       isActive: true,
  //     },
  //   });

  //   if (!membership) {
  //     throw new ForbiddenException(
  //       'Only organization owners can perform this action',
  //     );
  //   }
  // }

  private async verifyMembership(orgId: string, userId: string) {
    const membership = await this.prisma.organizationMember.findFirst({
      where: {
        organizationId: orgId,
        userId: userId,
        isActive: true,
      },
    });

    if (!membership) {
      throw new ForbiddenException('Organization access denied');
    }
  }

  private async cancelSubscription(orgId: string) {
    // Integrate with your billing service (Stripe, etc.)
    // This is a placeholder implementation
    console.log(`Canceling subscription for organization ${orgId}`);
  }
}
