import { PrismaService } from '@/prisma/prisma.service';
import { Prisma } from '@generated/client';
import { Injectable, BadRequestException } from '@nestjs/common';
import * as twitter from 'twitter-text';
import { PlatformRulesService } from './platform-rules.service';
import { CreatePostDto } from '../dto/request/create-post.dto';
import { MediaItem } from '../interfaces/post.interface';

@Injectable()
export class DestinationBuilder {
  constructor(
    private platformRules: PlatformRulesService,
    private prisma: PrismaService,
  ) {}

  buildOverrideMap(overrides: any[]) {
    const map = new Map<string, string>();
    overrides?.forEach((o) => map.set(o.socialProfileId, o.content));
    return map;
  }

  /**
   * PHASE 1: PREPARATION
   * Call this BEFORE prisma.$transaction
   *
   * Rules:
   * - If dto.threads exists (Twitter only): validate each tweet, DO NOT autosplit
   * - Else: autosplit for Twitter when needed (via PlatformRulesService)
   * - Always store thread parts in payload.metadata.threadChain
   */
async preparePayloads(
  workspaceId: string,
  dto: CreatePostDto,
): Promise<any[]> {
  // 1) Fetch profiles
  const profiles = await this.prisma.socialProfile.findMany({
    where: { id: { in: dto.socialProfileIds }, workspaceId },
    select: { id: true, platform: true, name: true },
  });

  if (profiles.length !== dto.socialProfileIds.length) {
    throw new BadRequestException('One or more profiles do not belong to this workspace.');
  }

  // 2) Collect ALL Media IDs (Master + Threads)
  const allMediaIds = new Set<string>(dto.mediaIds ?? []);
  dto.threads?.forEach((t) => t.mediaIds?.forEach((id) => allMediaIds.add(id)));

  // 3) Fetch metadata for ALL media and create a Map for O(1) lookup
  const dbMedia = allMediaIds.size > 0
    ? await this.prisma.mediaFile.findMany({
        where: { id: { in: Array.from(allMediaIds) } },
        select: { id: true, width: true, height: true, mimeType: true },
      })
    : [];
  
  const mediaMap = new Map(dbMedia.map((m) => [m.id, m]));

  // 4) Overrides & Thread normalization
  const overrideMap = this.buildOverrideMap(dto.overrides);
  const hasExplicitThreads = Array.isArray(dto.threads) && dto.threads.length > 0;
  const explicitThreadChain = hasExplicitThreads
    ? dto.threads.map((t) => (t?.content ?? '').trim()).filter(Boolean)
    : [];

  const payloads: any[] = [];
  const errors: string[] = [];

  for (const profile of profiles) {
    const isTwitter = profile.platform === 'TWITTER';
    const contentToValidate = (overrideMap.get(profile.id) ?? dto.content ?? '').trim();

    try {
      // -----------------------------------------------------------
      // A) TWITTER + EXPLICIT THREADS
      // -----------------------------------------------------------
      if (isTwitter && hasExplicitThreads) {
        if (overrideMap.has(profile.id)) {
          throw new BadRequestException('Twitter content override cannot be used with threads.');
        }

        // Validate Master Tweet Media
        const masterMedia = (dto.mediaIds ?? []).map(id => mediaMap.get(id)).filter(Boolean);
        this.validateSingleTweetOrThrow(dto.content, masterMedia);

        // Validate Each Thread Item
        dto.threads.forEach((thread, index) => {
          const threadMedia = (thread.mediaIds ?? []).map(id => mediaMap.get(id)).filter(Boolean);
          try {
            this.validateSingleTweetOrThrow(thread.content, threadMedia);
          } catch (e) {
            throw new BadRequestException(`Thread item #${index + 1}: ${e.message}`);
          }
        });

        payloads.push({
          socialProfileId: profile.id,
          status: 'SCHEDULED',
          platform: profile.platform,
          contentOverride: dto.content,
          metadata: { threadChain: explicitThreadChain },
        });
        continue;
      }

      // -----------------------------------------------------------
      // B) DEFAULT (Autosplit or Single Post)
      // -----------------------------------------------------------
      const profileMedia = (dto.mediaIds ?? []).map(id => mediaMap.get(id)).filter(Boolean);
      const result = this.platformRules.validateAndTransform(
        contentToValidate,
        profile.platform as any,
        profileMedia,
      );

      payloads.push({
        socialProfileId: profile.id,
        status: 'SCHEDULED',
        platform: profile.platform,
        contentOverride: result.finalContent,
        metadata: result.threadChain?.length ? { threadChain: result.threadChain } : undefined,
      });

    } catch (err: any) {
      errors.push(`[${profile.name}]: ${err?.message}`);
    }
  }

  if (errors.length) {
    throw new BadRequestException(`Validation Failed:\n${errors.join('\n')}`);
  }

  return payloads;
}

/**
 * Updated to handle media validation too
 */
private validateSingleTweetOrThrow(content: string, media: any[]) {
  const text = (content ?? '').trim();
  if (!text) throw new BadRequestException('Tweet cannot be empty.');

  const parsed = twitter.parseTweet(text);
  if (!parsed.valid) throw new BadRequestException('Tweet exceeds X limits (280 weighted chars).');

  if (media.length > 4) throw new BadRequestException('X allows max 4 media items per tweet.');
}
  /**
   * PHASE 2: EXECUTION
   * Call inside prisma.$transaction
   */
  async saveDestinations(
    tx: Prisma.TransactionClient,
    postId: string,
    payloads: any[],
  ) {
    if (!payloads.length) return;

    await tx.postDestination.createMany({
      data: payloads.map((p) => ({
        postId,
        socialProfileId: p.socialProfileId,
        status: p.status,
        contentOverride: p.contentOverride,
        metadata: p.metadata ?? Prisma.JsonNull,
      })),
    });
  }
}
