import { Controller } from '@nestjs/common';
import { AnalyticsService } from './services/analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}
}
