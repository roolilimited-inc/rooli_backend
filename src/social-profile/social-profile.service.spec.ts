import { Test, TestingModule } from '@nestjs/testing';
import { SocialProfileService } from './social-profile.service';

describe('SocialProfileService', () => {
  let service: SocialProfileService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SocialProfileService],
    }).compile();

    service = module.get<SocialProfileService>(SocialProfileService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
