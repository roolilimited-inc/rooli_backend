import { PrismaService } from "@/prisma/prisma.service";
import { Prisma } from "@generated/client";
import { Injectable, BadRequestException } from "@nestjs/common";

@Injectable()
export class DestinationBuilder {
  constructor(private readonly prisma: PrismaService) {}

  async validateProfiles(
    workspaceId: string,
    socialProfileIds: string[],
  ) {
    const profiles = await this.prisma.socialProfile.findMany({
      where: {
        id: { in: socialProfileIds },
        workspaceId,
      },
      select: { id: true },
    });

    if (profiles.length !== socialProfileIds.length) {
      throw new BadRequestException(
        'One or more selected profiles do not belong to this workspace.',
      );
    }

    return profiles;
  }

  buildOverrideMap(overrides?: { socialProfileId: string; content: string }[]) {
    const map = new Map<string, string>();
    overrides?.forEach(o => map.set(o.socialProfileId, o.content));
    return map;
  }

  async createDestinations(
    tx: Prisma.TransactionClient,
    postId: string,
    profiles: { id: string }[],
    options?: {
      overrideMap?: Map<string, string>;
      targetProfileIds?: string[];
    },
  ) {
    const applicableProfiles = options?.targetProfileIds?.length
      ? profiles.filter(p => options.targetProfileIds!.includes(p.id))
      : profiles;

    if (!applicableProfiles.length) return;

    await tx.postDestination.createMany({
      data: applicableProfiles.map(profile => ({
        postId,
        socialProfileId: profile.id,
        status: 'SCHEDULED',
        contentOverride: options?.overrideMap?.get(profile.id) ?? null,
      })),
    });
  }
}
