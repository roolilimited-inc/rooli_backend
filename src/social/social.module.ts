import { Module } from '@nestjs/common';
import { TwitterProvider } from './providers/twitter.provider';
import { SocialFactory } from './social.factory';

@Module({
  providers: [SocialFactory, TwitterProvider, LinkedInProvider],
  exports: [SocialFactory],
})
export class SocialModule {}
