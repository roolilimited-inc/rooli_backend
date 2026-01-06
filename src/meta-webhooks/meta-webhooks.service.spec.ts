import { Test, TestingModule } from '@nestjs/testing';
import { MetaWebhooksService } from './meta-webhooks.service';

describe('MetaWebhooksService', () => {
  let service: MetaWebhooksService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MetaWebhooksService],
    }).compile();

    service = module.get<MetaWebhooksService>(MetaWebhooksService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
