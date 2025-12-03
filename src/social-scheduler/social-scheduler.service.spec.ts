import { Test, TestingModule } from '@nestjs/testing';
import { SocialSchedulerService } from './services/social-scheduler.service';

describe('SocialSchedulerService', () => {
  let service: SocialSchedulerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SocialSchedulerService],
    }).compile();

    service = module.get<SocialSchedulerService>(SocialSchedulerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
