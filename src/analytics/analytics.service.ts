import { PrismaService } from '@/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { startOfUtcDay, subtractDaysUtc } from './analytics.util';
import { Platform } from '@generated/enums';
import { SocialProviderFactory } from './providers/social-provider.factory';
import pLimit from 'p-limit';
import { EncryptionService } from '@/common/utility/encryption.service';

type AccountMetrics = {
  followersTotal?: number;
  followersGained?: number; // optional if you truly have it
  followersLost?: number;
  impressions?: number;
  reach?: number;
  profileViews?: number;
  websiteClicks?: number;
  engagementCount?: number;
  metadata?: any;
};

type PostMetrics = {
  likes?: number;
  comments?: number;
  shares?: number;
  impressions?: number;
  reach?: number;
  clicks?: number;
  saves?: number;
  videoViews?: number;
  metadata?: any;
};

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: SocialProviderFactory,
    private readonly encryptionService: EncryptionService,
  ) {}

  /**
   * Nightly: account/page analytics for all connected social profiles.
   */
  async collectAccountAnalytics(dayIso?: string) {
    const day = dayIso
      ? startOfUtcDay(new Date(dayIso))
      : startOfUtcDay(new Date());

    // Pull active social profiles that you support analytics for
    const profiles = await this.prisma.socialProfile.findMany({
      where: { isActive: true },
      select: {
        id: true,
        platform: true,
        platformId: true,
        accessToken: true, // page token for FB/IG
        socialConnectionId: true,
          type: true,
        connection: {
          select: {
            accessToken: true, // user token (and twitter token)
            refreshToken: true, // twitter secret in your current schema
            tokenExpiresAt: true,
            platformUserId: true,
          },
        },
      },
    });

    this.logger.log(
      `Collecting account analytics: profiles=${profiles.length} day=${day.toISOString().slice(0, 10)}`,
    );

    // Important: throttle per platform. Keep it simple: sequential per platform groups.
    const byPlatform = new Map<string, typeof profiles>();
    for (const p of profiles) {
      const key = p.platform;
      byPlatform.set(key, [...(byPlatform.get(key) ?? []), p]);
    }

    for (const [platform, group] of byPlatform.entries()) {
      this.logger.log(
        `Account analytics platform=${platform} count=${group.length}`,
      );

      // Conservative: sequential. You can add limited concurrency later.
      for (const profile of group) {
        try {
          const provider = this.providerFactory.getProvider(profile.platform);

          const credentials = await this.getDecryptedCredentials(profile);

          // You implement this in each provider (Meta/LinkedIn/X)
          const metrics: AccountMetrics = await provider.fetchAccountAnalytics({
            socialProfileId: profile.id,
            day,
            credentials,
            metadata: { orgUrn: profile.type === "LINKEDIN_PAGE" ? profile.platformId : undefined,}
          });

          await this.upsertAccountAnalytics(
            profile.id,
            day,
            profile.platform,
            metrics,
          );
        } catch (e: any) {
          this.logger.warn(
            `Account analytics failed profile=${profile.id} platform=${platform} err=${e?.message ?? e}`,
          );
          // Optional: store error somewhere (AnalyticsJobLog). Don’t throw; continue.
        }
      }
    }
  }

  /**
   * Nightly: post analytics for destinations published in last 7 days.
   */
  async collectPostAnalytics(dayIso?: string) {
    const day = dayIso
      ? startOfUtcDay(new Date(dayIso))
      : startOfUtcDay(new Date());
    const cutoff = startOfUtcDay(subtractDaysUtc(7, day));

    // 1. Fetch destinations WITH connection info needed for credentials
    const destinations = await this.prisma.postDestination.findMany({
      where: {
        status: 'PUBLISHED' as any,
        platformPostId: { not: null },
        publishedAt: { gte: cutoff },
      },
      select: {
        id: true,
        platformPostId: true,
        socialProfileId: true,
        profile: {
          select: {
            platform: true,
            accessToken: true, // The Token
            socialConnectionId: true,
            connection: {
              select: {
                refreshToken: true, // The Secret (Twitter)
              },
            },
          },
        },
      },
    });

    // 2. Group by Platform
    const byPlatform = new Map<Platform, typeof destinations>();
    for (const d of destinations) {
      const plat = d.profile.platform as Platform;
      byPlatform.set(plat, [...(byPlatform.get(plat) ?? []), d]);
    }

    for (const [platform, group] of byPlatform.entries()) {
      if (platform === 'TWITTER') {
        // Pass the already fetched data to the batch processor
        await this.processTwitterBatches(group, day);
        continue;
      }

      if (platform === 'LINKEDIN') {
        await this.processLinkedInOptimized(group, day);
        continue;
      }

      // Concurrent processing for other platforms (FB/LinkedIn)
      const limit = pLimit(5);
      await Promise.all(
        group.map((dest) =>
          limit(async () => {
            try {
              const provider = this.providerFactory.getProvider(platform);

              const credentials = await this.getDecryptedCredentials(dest.profile);

              const metrics = await provider.fetchPostAnalytics({
                platformPostId: dest.platformPostId!,
                socialProfileId: dest.socialProfileId,
                day,
                credentials
              });
              await this.upsertPostSnapshot(dest.id, day, metrics);
            } catch (e: any) {
              this.logger.warn(
                `Post analytics failed id=${dest.id} err=${e.message}`,
              );
            }
          }),
        ),
      );
    }

    await this.aggregateAccountAnalyticsFromPosts(day);
  }

  private async processTwitterBatches(destinations: any[], day: Date) {
    // 1. Batch by Social Connection (Credential Set)
    // Twitter API requires the request be signed by the specific user context
    const byConnection = new Map<string, typeof destinations>();

    for (const d of destinations) {
      const connId = d.profile.socialConnectionId;
      byConnection.set(connId, [...(byConnection.get(connId) ?? []), d]);
    }

    const provider = this.providerFactory.getProvider('TWITTER');

    for (const [connectionId, group] of byConnection.entries()) {
      try {
        // We can grab credentials from the first item in the group
        // because we grouped by connectionId.
        const first = group[0];

        const credentials = {
          platform: 'TWITTER' as Platform,
          accessToken: first.profile.accessToken, // From Profile
          accessSecret: first.profile.connection?.refreshToken, // From Connection
        };

        const ids = group.map((g) => g.platformPostId).filter(Boolean);

        // Provider handles chunking (100 ids), we just pass the full list for this user
        const batchMetrics = await provider.fetchBatchPostAnalytics!({
          platformPostIds: ids,
          day,
          credentials,
        });

        // Save results
        for (const dest of group) {
          const m = batchMetrics.get(dest.platformPostId);
          if (!m) continue; // Tweet might be deleted or suspended
          await this.upsertPostSnapshot(dest.id, day, m);
        }

        this.logger.log(
          `Twitter batch processed: conn=${connectionId} posts=${group.length}`,
        );
      } catch (e: any) {
        this.logger.error(
          `Twitter batch failed conn=${connectionId} err=${e.message}`,
        );
      }
    }
  }

  private async upsertAccountAnalytics(
    socialProfileId: string,
    day: Date,
    platform: string,
    metrics: AccountMetrics,
  ) {
    await this.prisma.accountAnalytics.upsert({
      where: {
        socialProfileId_date: { socialProfileId, date: day },
      },
      create: {
        socialProfileId,
        date: day,
        followersTotal: metrics.followersTotal ?? 0,
        followersGained: metrics.followersGained ?? 0,
        followersLost: metrics.followersLost ?? 0,
        impressions: metrics.impressions ?? 0,
        reach: metrics.reach ?? 0,
        profileViews: metrics.profileViews ?? 0,
        websiteClicks: metrics.websiteClicks ?? 0,
        engagementCount: metrics.engagementCount ?? 0,
      },
      update: {
        followersTotal: metrics.followersTotal ?? 0,
        followersGained: metrics.followersGained ?? 0,
        followersLost: metrics.followersLost ?? 0,
        impressions: metrics.impressions ?? 0,
        reach: metrics.reach ?? 0,
        profileViews: metrics.profileViews ?? 0,
        websiteClicks: metrics.websiteClicks ?? 0,
        engagementCount: metrics.engagementCount ?? 0,
      },
    });
  }

  private async upsertPostSnapshot(
    postDestinationId: string,
    day: Date,
    metrics: PostMetrics,
  ) {
    await this.prisma.postAnalyticsSnapshot.upsert({
      where: { postDestinationId_day: { postDestinationId, day } },
      create: {
        postDestinationId,
        day,
        likes: metrics.likes ?? 0,
        comments: metrics.comments ?? 0,
        shares: metrics.shares ?? 0,
        impressions: metrics.impressions ?? 0,
        reach: metrics.reach ?? 0,
        clicks: metrics.clicks ?? 0,
        saves: metrics.saves ?? 0,
        videoViews: metrics.videoViews ?? 0,
        metadata: metrics.metadata ?? undefined,
      },
      update: {
        fetchedAt: new Date(),
        likes: metrics.likes ?? 0,
        comments: metrics.comments ?? 0,
        shares: metrics.shares ?? 0,
        impressions: metrics.impressions ?? 0,
        reach: metrics.reach ?? 0,
        clicks: metrics.clicks ?? 0,
        saves: metrics.saves ?? 0,
        videoViews: metrics.videoViews ?? 0,
        metadata: metrics.metadata ?? undefined,
      },
    });
  }

  async aggregateAccountAnalyticsFromPosts(day: Date) {
    // 1) Pull snapshots for that day + join to socialProfileId
    const rows = await this.prisma.postAnalyticsSnapshot.findMany({
      where: { day },
      select: {
        likes: true,
        comments: true,
        shares: true,
        saves: true,
        impressions: true,
        reach: true,
        clicks: true,
        videoViews: true,
        postDestination: {
          select: {
            socialProfileId: true,
            profile: { select: { platform: true } },
          },
        },
      },
    });

    // 2) Group in memory by socialProfileId
    const agg = new Map<string, any>();

    for (const r of rows) {
      const socialProfileId = r.postDestination.socialProfileId;
      const prev = agg.get(socialProfileId) ?? {
        socialProfileId,
        platform: r.postDestination.profile.platform,
        impressions: 0,
        reach: 0,
        websiteClicks: 0,
        engagementCount: 0,
        videoViews: 0,
      };

      prev.impressions += r.impressions ?? 0;
      prev.reach += r.reach ?? 0;
      prev.websiteClicks += r.clicks ?? 0;
      prev.videoViews += r.videoViews ?? 0;

      const engagements =
        (r.likes ?? 0) + (r.comments ?? 0) + (r.shares ?? 0) + (r.saves ?? 0);

      prev.engagementCount += engagements;

      agg.set(socialProfileId, prev);
    }

    // 3) Upsert into AccountAnalytics (derived-from-posts values)
    for (const a of agg.values()) {
      await this.prisma.accountAnalytics.upsert({
        where: {
          socialProfileId_date: {
            socialProfileId: a.socialProfileId,
            date: day,
          },
        }, // Correction: key is usually socialProfileId_date in schema
        create: {
          socialProfileId: a.socialProfileId,
          date: day,
          impressions: a.impressions,
          reach: a.reach,
          websiteClicks: a.websiteClicks,
          engagementCount: a.engagementCount,
          followersTotal: 0,
          followersGained: 0,
          followersLost: 0,
        },
        update: {
          impressions: a.impressions,
          reach: a.reach,
          websiteClicks: a.websiteClicks,
          engagementCount: a.engagementCount,
        },
      });
    }
  }

  private async processLinkedInOptimized(destinations: any[], day: Date) {
  const provider = this.providerFactory.getProvider('LINKEDIN') as any; // LinkedInAnalyticsProvider
  // Split org vs person
  const orgDest: any[] = [];
  const personDest: any[] = [];

  for (const d of destinations) {
    if (d.profile.type === 'ORGANIZATION') orgDest.push(d);
    else personDest.push(d);
  }

  // 1) ORG: group by orgUrn (platformId) and call org share stats once per org
  const byOrg = new Map<string, any[]>();
  for (const d of orgDest) {
    const orgUrn = d.profile.platformId; // should be urn:li:organization:...
    byOrg.set(orgUrn, [...(byOrg.get(orgUrn) ?? []), d]);
  }

  for (const [orgUrn, group] of byOrg.entries()) {
    const accessToken = group[0]?.profile?.connection?.accessToken;
    if (!accessToken) {
      this.logger.warn(`LinkedIn org stats skipped: missing token orgUrn=${orgUrn}`);
      continue;
    }

    try {
      const statsMap: Map<string, PostMetrics> = await provider.fetchOrgShareStats(orgUrn, accessToken);

      for (const dest of group) {
        const m = statsMap.get(dest.platformPostId);
        if (!m) continue; // share not in stats window
        await this.upsertPostSnapshot(dest.id, day, m);
      }

      this.logger.log(`LinkedIn org stats saved: org=${orgUrn} posts=${group.length}`);
    } catch (e: any) {
      this.logger.warn(`LinkedIn org stats failed org=${orgUrn} err=${e?.message ?? e}`);
    }
  }

  // 2) PERSON: fallback per post (socialActions)
  for (const dest of personDest) {
    const accessToken = dest.profile.connection?.accessToken;
    if (!accessToken) continue;

    try {
      const m: PostMetrics = await provider.fetchPostAnalytics({
        platformPostId: dest.platformPostId!,
        socialProfileId: dest.socialProfileId,
        day,
        credentials: {
          platform: 'LINKEDIN',
          accessToken,
        },
      });

      await this.upsertPostSnapshot(dest.id, day, m);
    } catch (e: any) {
      this.logger.warn(
        `LinkedIn person post analytics failed dest=${dest.id} err=${e?.message ?? e}`,
      );
    }
  }
}

/**
   * Helper to handle decryption safely
   */
  private async getDecryptedCredentials(profile: any) {
    const accessTokenEnc = profile.accessToken;
    // Twitter secret is stored in connection.refreshToken
    const accessSecretEnc = profile.connection?.refreshToken; 

    return {
      platform: profile.platform as Platform,
      // Decrypt if exists, else undefined
      accessToken: accessTokenEnc ? await this.encryptionService.decrypt(accessTokenEnc) : undefined,
      accessSecret: accessSecretEnc ? await this.encryptionService.decrypt(accessSecretEnc) : undefined,
    };
  }

}
