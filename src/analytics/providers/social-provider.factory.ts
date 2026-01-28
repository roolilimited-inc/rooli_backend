// social/providers/social-provider.factory.ts
import { Platform } from '@generated/enums';
import { Injectable } from '@nestjs/common';
import { AnalyticsProvider } from '../interfaces/analytics-strategy.interface';
import { TwitterAnalyticsProvider } from './twitter.provider';



@Injectable()
export class SocialProviderFactory {
  private readonly providers = new Map<Platform, AnalyticsProvider>();

  constructor(
    private readonly twitter: TwitterAnalyticsProvider,
    // private readonly meta: MetaAnalyticsProvider,
    // private readonly linkedIn: LinkedInAnalyticsProvider,
  ) {
    this.providers.set('TWITTER', this.twitter);
    // this.providers.set('FACEBOOK', this.meta);
    // this.providers.set('INSTAGRAM', this.meta);
    // this.providers.set('LINKEDIN', this.linkedIn);
  }

  getProvider(platform: Platform): AnalyticsProvider {
    const p = this.providers.get(platform);
    if (!p) throw new Error(`No analytics provider registered for platform=${platform}`);
    return p;
  }
}
