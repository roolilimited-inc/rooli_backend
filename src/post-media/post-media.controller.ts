import { Controller } from '@nestjs/common';
import { PostMediaService } from './post-media.service';

@Controller('post-media')
export class PostMediaController {
  constructor(private readonly postMediaService: PostMediaService) {}
}
