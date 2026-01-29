import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { IAnalyticsProvider } from '../interfaces/analytics-provider.interface';
import { AccountRawData, PostRawData } from '../interfaces/normalized-data.interface';


@Injectable()
export class LinkedInAnalyticsProvider implements IAnalyticsProvider {
  private readonly logger = new Logger(LinkedInAnalyticsProvider.name);
  private readonly baseUrl = 'https://api.linkedin.com/v2';

  constructor(private readonly config: ConfigService) {}

  async getAccountStats(urn: string, token: string): Promise<AccountRawData> {
    try {
      // 1. Call External API
      const response = await axios.get(`${this.baseUrl}/networkSizes/${urn}?edgeType=Company`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      // 2. Normalize Data (Map API -> Interface)
      return {
        platformId: urn,
        followersCount: response.data.firstDegreeSize,
        fetchedAt: new Date(),
        // LinkedIn doesn't give profile views in this specific endpoint, so we leave it undefined
        profileViews: undefined, 
      };
    } catch (error) {
      this.logger.error(`Failed to fetch LinkedIn stats for ${urn}`, error);
      throw error;
    }
  }

  async getPostStats(postUrns: string[], token: string): Promise<PostRawData[]> {
    // LinkedIn allows batching via 'shares' parameter
    // Implementation of batch request...
    return []; // Placeholder for brevity
  }
}