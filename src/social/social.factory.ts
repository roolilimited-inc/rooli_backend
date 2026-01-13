import { Injectable, BadRequestException } from '@nestjs/common';
import { TwitterProvider } from './providers/twitter.provider';
import { ISocialProvider } from './interfaces/social-provider.interface';

@Injectable()
export class SocialFactory {
  constructor(
    private twitter: TwitterProvider,
    private linkedin: LinkedInProvider,
  ) {}

  getProvider(platform: Platform): ISocialProvider {
    switch (platform) {
      case 'TWITTER':
        return this.twitter;
      case 'LINKEDIN':
        return this.linkedin;
      // case 'FACEBOOK': return this.facebook;
      default:
        throw new BadRequestException(`Platform ${platform} is not supported yet.`);
    }
  }
}