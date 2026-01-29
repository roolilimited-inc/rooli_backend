import {  Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Platform } from '@generated/enums';
import { AccountMetrics, AuthCredentials, IAnalyticsProvider, PostMetrics } from '../interfaces/analytics-provider.interface';

@Injectable()
export class LinkedInAnalyticsProvider implements IAnalyticsProvider {
  platform: Platform = 'LINKEDIN';
  private readonly logger = new Logger(LinkedInAnalyticsProvider.name);
  private readonly baseUrl = 'https://api.linkedin.com/rest';

  constructor(private readonly http: HttpService) {}

  private headers(token: string) {
    return {
      Authorization: `Bearer ${token}`,
      'LinkedIn-Version': '202601',
      'X-Restli-Protocol-Version': '2.0.0',
    };
  }

  async getAccountStats(id: string, credentials: AuthCredentials): Promise<AccountMetrics> {
    const token = credentials.accessToken;
    const fullUrn = this.ensureUrn(id);

  if (fullUrn.includes('organization')) {
      return this.getOrganizationStats(fullUrn, token);
    }
    return this.getPersonalProfileStats(fullUrn, token);
  }

  
  private async getOrganizationStats(
    orgUrn: string,
    token: string,
  ): Promise<AccountMetrics> {
    // Follower count (most useful + most reliable)
    // REST/V2 endpoint style may vary. This is the canonical shape:
    const url =
      `${this.baseUrl}/networkSizes/${encodeURIComponent(orgUrn)}` +
      `?edgeType=CompanyFollower`;

    try {
      const { data } = await firstValueFrom(
        this.http.get(url, { headers: this.headers(token) }),
      );

      return {
        platformId: orgUrn,
        followersCount: data?.firstDegreeSize ?? 0, 
        fetchedAt: new Date(), 
        impressionsCount: undefined,
        profileViews: undefined,
      };
    } catch (e: any) {
      this.logger.warn(
        `LinkedIn org stats failed orgUrn=${orgUrn} err=${e?.message ?? e}`,
      );
      return {
         platformId: orgUrn,
        followersCount: undefined, 
        fetchedAt: new Date(), 
        impressionsCount: undefined,
        profileViews: undefined,
      };
    }
  }

  private async getPersonalProfileStats(
    personUrn: string,
    token: string,
  ): Promise<AccountMetrics> {
 /**
     * LinkedIn does NOT give a nice “profile analytics dashboard” via API.
     * Best you can usually do is follower count (if permitted) + basic identity info.
     *
     * For follower count, LinkedIn uses networkSizes with different edge types.
     * Common edge types:
     * - MemberFollower / Follower (varies by API program)
     *
     * We’ll try a couple and return the first that works.
     */

    const edgeTypesToTry = ['MemberFollower', 'Follower'];

    for (const edgeType of edgeTypesToTry) {
      const url =
        `${this.baseUrl}/networkSizes/${encodeURIComponent(personUrn)}` +
        `?edgeType=${encodeURIComponent(edgeType)}`;

      try {
        const { data } = await firstValueFrom(
          this.http.get(url, { headers: this.headers(token) }),
        );

        // If it succeeds, return follower count
        return {
           platformId: personUrn,
        followersCount: data?.firstDegreeSize ?? 0, 
        fetchedAt: new Date(), 
        impressionsCount: undefined,
        profileViews: undefined,
        };
      } catch (e: any) {
        // try next edge type
        this.logger.debug(
          `LinkedIn person follower count failed urn=${personUrn} edgeType=${edgeType} err=${e?.message ?? e}`,
        );
      }
    }

    // If none worked, return “not available”
    return {
       platformId: personUrn,
        followersCount: undefined, 
        fetchedAt: new Date(), 
        impressionsCount: undefined,
        profileViews: undefined,
    };
  }

  async getPostStats(
    postIds: string[],
   credentials: AuthCredentials,
    context?: { pageId?: string },
  ): Promise<PostMetrics[]> {
    const token = credentials.accessToken;
    if (postIds.length === 0) return [];
    // Ensure all post IDs are URNs (shares or ugcPosts)
    const postUrns = postIds.map(id => id.startsWith('urn:li:') ? id : `urn:li:share:${id}`);

    // 1. Check if we are dealing with a Company Page or Personal Profile
    // We assume if 'context.pageId' is provided, it's a Company Page.
    if (context?.pageId) {
      const orgUrn = this.ensureUrn(context.pageId);
      return this.fetchCompanyPageStats(postUrns, token, orgUrn);
    } else {
      return this.fetchPersonalProfileStats(postUrns, token);
    }
  }
  /**
   * ✅ COMPANY PAGES: "Batch" by org
   *
   * Best practice:
   * - Try filtered shares=List(...) in chunks.
   * - If it fails (too long / unsupported), fall back to org-wide stats (no shares filter).
   */
  private async fetchCompanyPageStats(
    postUrns: string[],
    token: string,
    orgUrn: string,
  ): Promise<PostMetrics[]> {
    const chunks = this.chunkArray(postUrns, 20);
    const results: PostMetrics[] = [];

    // We use a regular loop for Company Pages to safely handle potential fallbacks
    for (const chunk of chunks) {
      try {
        const res = await this.fetchOrgShareStatsFiltered(chunk, token, orgUrn);
        results.push(...res);
      } catch (e: any) {
        this.logger.warn(`Filtered fetch failed, attempting org-wide fallback for chunk`);
        const fallback = await this.fetchOrgShareStatsOrgWide(token, orgUrn);
        const wanted = new Set(chunk);
        results.push(...fallback.filter((x) => wanted.has(x.postId)));
      }
      // Gentle throttle
      await new Promise((r) => setTimeout(r, 100));
    }

    return results;
  }
  /**
   * Filtered version: shares=List(urn:li:share:1,urn:li:share:2)
   * IMPORTANT: Do NOT encode each URN inside List(). Build raw List() then URL-encode the whole param value.
   */
  private async fetchOrgShareStatsFiltered(
    postUrns: string[],
    token: string,
    orgUrn: string,
  ): Promise<PostMetrics[]> {
    // Build raw List()
    const listValue = `List(${postUrns.join(',')})`;

    const url =
      `${this.baseUrl}/organizationalEntityShareStatistics` +
      `?q=organizationalEntity` +
      `&organizationalEntity=${encodeURIComponent(orgUrn)}` +
      `&shares=${encodeURIComponent(listValue)}`;

    const { data } = await firstValueFrom(
      this.http.get(url, { headers: this.headers(token) }),
    );

    return this.mapOrgShareStatsResponse(data);
  }

  /**
   * Org-wide version (no shares filter). Most reliable.
   * You call once/day per org in your optimized pipeline.
   */
  async fetchOrgShareStatsOrgWide(
    token: string,
    orgUrn: string,
  ): Promise<PostMetrics[]> {
    const url =
      `${this.baseUrl}/organizationalEntityShareStatistics` +
      `?q=organizationalEntity` +
      `&organizationalEntity=${encodeURIComponent(orgUrn)}`;

    const { data } = await firstValueFrom(
      this.http.get(url, { headers: this.headers(token) }),
    );

    return this.mapOrgShareStatsResponse(data);
  }

  private mapOrgShareStatsResponse(data: any): PostMetrics[] {
    const elements = data?.elements ?? [];
    return elements.map((element: any) => {
      const s = element.totalShareStatistics ?? {};
      return {
        postId: element.share,
        impressions: s.impressionCount ?? 0,
        likes: s.likeCount ?? 0,
        comments: s.commentCount ?? 0,
        shares: s.shareCount ?? 0,
        clicks: s.clickCount ?? 0,
        videoViews: undefined, // separate APIs if you ever do it
        metadata: element,
      };
    });
  }

  /**
   * ❌ PERSONAL PROFILES: No reliable batching.
   * Best effort: likes/comments via socialActions
   */
  private async fetchPersonalProfileStats(
    postUrns: string[],
    token: string,
  ): Promise<PostMetrics[]> {
    const results: PostMetrics[] = [];

    const chunkSize = 5;
    for (let i = 0; i < postUrns.length; i += chunkSize) {
      const chunk = postUrns.slice(i, i + chunkSize);

      const chunkResults = await Promise.all(
        chunk.map((urn) => this.fetchSinglePersonalPost(urn, token)),
      );

      results.push(...chunkResults.filter((r): r is PostMetrics => r !== null));

      await new Promise((r) => setTimeout(r, 500));
    }

    return results;
  }

  private async fetchSinglePersonalPost(
    urn: string,
    token: string,
  ): Promise<PostMetrics | null> {
    try {
      const url = `${this.baseUrl}/socialActions/${encodeURIComponent(urn)}`;

      const { data } = await firstValueFrom(
        this.http.get(url, { headers: this.headers(token) }),
      );

      return {
        postId: urn,
        // Don’t lie: these are typically not available for personal posts
        impressions: undefined,
        shares: undefined,
        clicks: undefined,

        likes: data?.likesSummary?.totalLikes ?? 0,
        // Some responses use totalFirstLevelComments; keep both
        comments:
          data?.commentsSummary?.totalFirstLevelComments ??
          data?.commentsSummary?.totalComments ??
          0,
      };
    } catch (error: any) {
      // deleted, forbidden, etc.
      this.logger.debug(
        `LinkedIn personal post analytics skipped urn=${urn} err=${error?.message ?? error}`,
      );
      return null;
    }
  }

    protected chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

private ensureUrn(id: string): string {
    if (id.startsWith('urn:li:')) {
      return id;
    }
    // If it's just a raw ID, we assume it's a person based on your storage logic
    return `urn:li:person:${id}`;
  }
}
