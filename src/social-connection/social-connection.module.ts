import { Module } from '@nestjs/common';
import { SocialConnectionService } from './social-connection.service';
import { SocialConnectionController } from './social-connection.controller';

@Module({
  controllers: [SocialConnectionController],
  providers: [SocialConnectionService],
})
export class SocialConnectionModule {}
