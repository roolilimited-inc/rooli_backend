
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { AnalyticsStrategy, PostMetrics, AccountMetrics, AnalyticsProvider, FetchAccountAnalyticsInput, FetchPostAnalyticsInput } from '../interfaces/analytics-strategy.interface';
import { Platform } from '@generated/enums';


@Injectable()
export class LinkedInAnalyticsProvider implements AnalyticsProvider {
  platform: Platform = 'LINKEDIN';
  private readonly logger = new Logger(LinkedInAnalyticsProvider.name);

  constructor(private readonly http: HttpService) {}

  async fetchPostAnalytics(input: FetchPostAnalyticsInput): Promise<PostMetrics> {
    const accessToken = input.credentials.accessToken;
    if (!accessToken) throw new Error('LinkedIn accessToken missing');

    // socialActions expects the encoded URN
    const encoded = encodeURIComponent(input.platformPostId);
    const url = `https://api.linkedin.com/v2/socialActions/${encoded}`;

    const { data } = await lastValueFrom(
      this.http.get(url, { headers: { Authorization: `Bearer ${accessToken}` } }),
    );

    return {
      likes: data.likesSummary?.totalLikes ?? 0,
      comments: data.commentsSummary?.totalFirstLevelComments ?? 0,
      // These are not reliably available here:
      impressions: undefined,
      clicks: undefined,
      shares: undefined,
      reach: undefined,
      metadata: data,
    };
  }

  // ✅ Optimized: org-wide share stats (your “batch”)
  async fetchOrgShareStats(orgUrn: string, accessToken: string): Promise<Map<string, PostMetrics>> {
    if (!orgUrn?.startsWith('urn:li:organization:')) {
      throw new Error(`Invalid orgUrn: ${orgUrn}`);
    }
    if (!accessToken) throw new Error('LinkedIn accessToken missing');

    const url =
      `https://api.linkedin.com/v2/organizationalEntityShareStatistics` +
      `?q=organizationalEntity&organizationalEntity=${encodeURIComponent(orgUrn)}`;

    const { data } = await lastValueFrom(
      this.http.get(url, { headers: { Authorization: `Bearer ${accessToken}` } }),
    );

    const map = new Map<string, PostMetrics>();
    const elements = data?.elements ?? [];

    for (const el of elements) {
      const s = el.totalShareStatistics ?? {};
      map.set(el.share, {
        likes: s.likeCount ?? 0,
        comments: s.commentCount ?? 0,
        shares: s.shareCount ?? 0,
        impressions: s.impressionCount ?? 0,
        clicks: s.clickCount ?? 0,
        // LinkedIn doesn’t give “reach” here
        reach: undefined,
        metadata: el,
      });
    }

    return map;
  }

  // ✅ Account-ish: follower count
  async fetchAccountAnalytics(input: FetchAccountAnalyticsInput): Promise<AccountMetrics> {
    const accessToken = input.credentials.accessToken;
    if (!accessToken) throw new Error('LinkedIn accessToken missing');

    // input.socialProfileId is your DB id, not a URN.
    // You should pass orgUrn/personUrn in credentials.metadata or add a parameter.
    // For now: expect orgUrn in input.credentials.metadata.orgUrn
    const orgUrn = input.metadata?.orgUrn as string | undefined;
    if (!orgUrn) {
      // Don’t break the job — just return empty
      return { followersTotal: 0, metadata: { note: 'Missing orgUrn' } };
    }

    const url = `https://api.linkedin.com/v2/networkSizes/${encodeURIComponent(
      orgUrn,
    )}?edgeType=CompanyFollower`;

    const { data } = await lastValueFrom(
      this.http.get(url, { headers: { Authorization: `Bearer ${accessToken}` } }),
    );

    return {
      followersTotal: data?.firstDegreeSize ?? 0,
      impressions: 0,
      reach: 0,
      profileViews: 0,
      metadata: data,
    };
  }
}