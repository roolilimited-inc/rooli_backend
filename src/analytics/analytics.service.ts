import { PrismaService } from '@/prisma/prisma.service';
import { Injectable, Logger } from '@nestjs/common';
import { startOfUtcDay, subtractDaysUtc } from './analytics.util';
import { Platform } from '@generated/enums';
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
    private readonly encryptionService: EncryptionService,
  ) {}


}
