import { Test, TestingModule } from '@nestjs/testing';
import { SocialSchedulerController } from './social-scheduler.controller';
import { SocialSchedulerService } from './services/social-scheduler.service';

describe('SocialSchedulerController', () => {
  let controller: SocialSchedulerController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SocialSchedulerController],
      providers: [SocialSchedulerService],
    }).compile();

    controller = module.get<SocialSchedulerController>(SocialSchedulerController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
