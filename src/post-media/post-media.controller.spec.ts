import { Test, TestingModule } from '@nestjs/testing';
import { PostMediaController } from './post-media.controller';
import { PostMediaService } from './post-media.service';

describe('PostMediaController', () => {
  let controller: PostMediaController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PostMediaController],
      providers: [PostMediaService],
    }).compile();

    controller = module.get<PostMediaController>(PostMediaController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
