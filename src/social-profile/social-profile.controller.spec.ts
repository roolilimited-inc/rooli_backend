import { Test, TestingModule } from '@nestjs/testing';
import { SocialProfileController } from './social-profile.controller';
import { SocialProfileService } from './social-profile.service';

describe('SocialProfileController', () => {
  let controller: SocialProfileController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SocialProfileController],
      providers: [SocialProfileService],
    }).compile();

    controller = module.get<SocialProfileController>(SocialProfileController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
