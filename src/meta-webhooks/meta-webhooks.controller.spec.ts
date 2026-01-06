import { Test, TestingModule } from '@nestjs/testing';
import { MetaWebhooksController } from './meta-webhooks.controller';
import { MetaWebhooksService } from './meta-webhooks.service';

describe('MetaWebhooksController', () => {
  let controller: MetaWebhooksController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MetaWebhooksController],
      providers: [MetaWebhooksService],
    }).compile();

    controller = module.get<MetaWebhooksController>(MetaWebhooksController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
