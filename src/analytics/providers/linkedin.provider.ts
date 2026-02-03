import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Platform } from '@generated/enums';
import {
  AccountMetrics,
  AuthCredentials,
  IAnalyticsProvider,
  PostMetrics,
} from '../interfaces/analytics-provider.interface';
import { DateTime } from 'luxon';

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

  async getAccountStats(
    id: string,
    credentials: AuthCredentials,
  ): Promise<AccountMetrics> {
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
    try {
      const headers = this.headers(token);
      const { period } = this.getAnalyticsWindow();
      const timeIntervals = `(timeRange:(start:${period.from},end:${period.to}),timeGranularityType:DAY)`;

      // Fetch Followers (Lifetime)
      const followerUrl = `${this.baseUrl}/organizationalEntityFollowerStatistics`;

      // Fetch Profile Performance (Daily Views/Clicks)
      const pageUrl = `${this.baseUrl}/organizationPageStatistics`;

      const shareUrl = `${this.baseUrl}/organizationalEntityShareStatistics`;
      const shareTimeIntervals = `(timeRange:(start:${period.from},end:${period.to}),timeGranularityType:DAY)`;

      const [followerRes, pageRes, shareRes] = await Promise.all([
        firstValueFrom(
          this.http.get(followerUrl, {
            headers,
            params: { q: 'organizationalEntity', organizationalEntity: orgUrn },
          }),
        ),
        firstValueFrom(
          this.http.get(pageUrl, {
            headers,
            params: {
              q: 'organization',
              organization: orgUrn,
              timeIntervals,
            },
          }),
        ),
        firstValueFrom(
          this.http.get(shareUrl, {
            headers,
            params: {
              q: 'organizationalEntity',
              organizationalEntity: orgUrn,
              timeIntervals: shareTimeIntervals,
            },
          }),
        ),
      ]);

      // --- Parse Followers ---
      const followerData = followerRes?.data?.elements?.[0] ?? {};
      const totalFollowers =
        followerData?.followerCountsByAssociationType?.find(
          (x: any) => x.associationType === 'ORGANIC',
        )?.followerCounts?.organicFollowerCount ?? 0;

      // --- Parse Profile Page Stats ---
      const pageElements: any[] = pageRes?.data?.elements ?? [];
      let profileViews = 0;
      let profileClicks = 0;

      for (const el of pageElements) {
        const stats = el.totalPageStatistics;
        // Sum daily stats if multiple days returned
        profileViews += stats?.views?.allPageViews?.uniquePageViews ?? 0;

        // STRICT SEPARATION: Only count clicks on the Profile itself
        profileClicks +=
          (stats?.clicks?.careersPageClicks?.clicks ?? 0) +
          (stats?.clicks?.websiteClicks?.clicks ?? 0) +
          (stats?.clicks?.drivingDirectionsClicks?.clicks ?? 0);
      }

      // --- Parse Demographics ---
      const demographics = {
        seniority: followerData?.followerCountsBySeniority ?? [],
        industry: followerData?.followerCountsByIndustry ?? [],
        function: followerData?.followerCountsByFunction ?? [],
        region: followerData?.followerCountsByRegion ?? [],
      };

      // sum totals across elements (usually 1 element, but be safe)
      const shareEls: any[] = shareRes?.data?.elements ?? [];
      let impressions = 0,
        postClicks = 0,
        reactions = 0,
        comments = 0,
        shares = 0;

      for (const el of shareEls) {
        const s = el?.totalShareStatistics ?? {};
        impressions += s?.impressionCount ?? 0;
        postClicks += s?.clickCount ?? 0;
        reactions += s?.likeCount ?? 0;
        comments += s?.commentCount ?? 0;
        shares += s?.shareCount ?? 0;
      }

      const engagementCount = postClicks + reactions + comments + shares;

      return {
        platformId: orgUrn,
        fetchedAt: new Date(),
        followersCount: totalFollowers,

        profileViews,
        clicks: profileClicks,

        impressionsCount: impressions,
        engagementCount,
        reach: undefined,

        demographics,
      };
    } catch (error) {
      this.logger.error(`LinkedIn Account Stats Failed: ${error.message}`);
      throw error;
    }
  }

  private async getPersonalProfileStats(
    personUrn: string,
    token: string,
  ): Promise<AccountMetrics> {
    try {
      const [followersRes, totals] = await Promise.all([
        firstValueFrom(
          this.http.get(`${this.baseUrl}/memberFollowersCount?q=me`, {
            headers: this.headers(token),
          }),
        ),
        this.getMemberAccountTotals(token),
      ]);

      const followers =
        followersRes?.data?.elements?.[0]?.memberFollowersCount ?? 0;

      return {
        platformId: personUrn,
        fetchedAt: new Date(),
        followersCount: followers,

        impressionsCount: totals.impressions,
        reach: totals.reached,
        engagementCount: totals.reactions + totals.comments + totals.reshares,

        profileViews: undefined, // not available
        clicks: undefined,
        demographics: undefined,
      };
    } catch (e: any) {
      console.log(e);
      this.logger.warn(`LinkedIn memberFollowersCount failed: ${e.message}`);
      throw e;
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
    const postUrns = postIds.map((id) =>
      id.startsWith('urn:li:') ? id : `urn:li:share:${id}`,
    );

    const isOrganizationContext =
      context?.pageId && context.pageId.includes('organization');
    // 1. Check if we are dealing with a Company Page or Personal Profile
    // We assume if 'context.pageId' is provided, it's a Company Page.
    if (isOrganizationContext) {
      const orgUrn = this.ensureUrn(context.pageId!);
      return this.fetchCompanyPageStats(orgUrn, token, postUrns);
    } else {
      // Fallback to Personal Profile logic
      return [];
    }
  }

  async fetchCompanyPageStats(
    orgUrn: string,
    token: string,
    postUrns: string[],
  ): Promise<PostMetrics[]> {
    if (!postUrns?.length) return [];

    const url = `${this.baseUrl}/organizationalEntityShareStatistics`;
    const headers = this.headers(token);

    const chunks = this.chunkArray(postUrns, 20);
    const out: PostMetrics[] = [];

    for (const chunk of chunks) {
      const params: Record<string, any> = {
        q: 'organizationalEntity',
        organizationalEntity: orgUrn,
      };

      chunk.forEach((urn, i) => {
        params[`shares[${i}]`] = urn; // no encodeURIComponent
      });

      try {
        const { data } = await firstValueFrom(
          this.http.get(url, { headers, params }),
        );
        out.push(...this.mapShareStatsElements(data?.elements ?? []));
      } catch (e: any) {
        this.logger.error(`LinkedIn Batch Failed: ${e?.message ?? e}`);
      }

      await new Promise((r) => setTimeout(r, 120));
    }

    return out;
  }

  async getMemberAccountTotals(token: string): Promise<{
    impressions: number;
    reactions: number;
    comments: number;
    reshares: number;
    reached: number;
  }> {
    const url = `${this.baseUrl}/memberCreatorPostAnalytics`;
    const headers = this.headers(token);

    // yesterday window
    const todayStart = DateTime.utc().startOf('day');
    const from = todayStart.minus({ days: 1 });
    const to = todayStart;

    const dateRange = `(start:(day:${from.day},month:${from.month},year:${from.year}),end:(day:${to.day},month:${to.month},year:${to.year}))`;

    const fetch = async (
      queryType: 'IMPRESSION' | 'REACTION' | 'COMMENT' | 'RESHARE',
      aggregation: 'DAILY' | 'TOTAL',
    ) => {
      const { data } = await firstValueFrom(
        this.http.get(url, {
          headers,
          params: { q: 'me', queryType, aggregation, dateRange },
        }),
      );
      const els: any[] = data?.elements ?? [];
      return aggregation === 'DAILY'
        ? els.reduce((s, e) => s + (e?.count ?? 0), 0)
        : (els?.[0]?.count ?? 0);
    };

    // MEMBERS_REACHED must be TOTAL
    const [impressions, reactions, comments, reshares, reached] =
      await Promise.all([
        fetch('IMPRESSION', 'DAILY'),
        fetch('REACTION', 'DAILY'),
        fetch('COMMENT', 'DAILY'),
        fetch('RESHARE', 'DAILY'),
        (async () => {
          const { data } = await firstValueFrom(
            this.http.get(url, {
              headers,
              params: {
                q: 'me',
                queryType: 'MEMBERS_REACHED',
                aggregation: 'TOTAL',
                dateRange,
              },
            }),
          );
          return data?.elements?.[0]?.count ?? 0;
        })(),
      ]);

    return { impressions, reactions, comments, reshares, reached };
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

  private mapShareStatsElements(elements: any[]): PostMetrics[] {
    return (elements ?? []).map((el: any) => {
      const stats = el?.totalShareStatistics ?? {};

      return {
        postId: el?.share || el?.ugcPost || el?.entity,
        impressions: stats?.impressionCount ?? 0,
        clicks: stats?.clickCount ?? 0,
        likes: stats?.likeCount ?? 0,
        comments: stats?.commentCount ?? 0,
        shares: stats?.shareCount ?? 0,

        reach: undefined,
        videoViews: undefined,
        saves: undefined,
      };
    });
  }

  /**
   * Returns a clean time range for "Yesterday".
   * - Aligns to 00:00:00 (Midnight) to prevent partial data.
   * - Returns both Date objects (for LinkedIn) and Unix Seconds (for FB/IG).
   */
  getAnalyticsWindow() {
    // 1. Get "Now" in UTC and snap to the start of today (Midnight 00:00:00)
    const today = DateTime.utc().startOf('day');

    // 2. Calculate previous days
    const yesterday = today.minus({ days: 1 });
    const twoDaysAgo = today.minus({ days: 2 });

    return {
      period: {
        from: yesterday.toMillis(),
        to: today.toMillis(),
      },
    };
  }
}
