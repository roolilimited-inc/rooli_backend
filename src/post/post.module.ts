import { Module } from '@nestjs/common';
import { PostService } from './post.service';
import { PostController } from './post.controller';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'media-ingest',
    }),
  ],
  controllers: [PostController],
  providers: [PostService],
})
export class PostModule {}
