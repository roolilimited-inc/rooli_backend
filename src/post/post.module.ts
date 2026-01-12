import { Module } from '@nestjs/common';
import { PostService } from './post.service';
import { PostController } from './controllers/post.controller';
import { BullModule } from '@nestjs/bullmq';
import { PostApprovalController } from './controllers/post-approval.controller';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'media-ingest',
    }),
  ],
  controllers: [PostController, PostApprovalController],
  providers: [PostService],
})
export class PostModule {}
