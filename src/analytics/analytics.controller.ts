import { Body, Controller, Post } from '@nestjs/common';
import { AnalyticsService } from './services/analytics.service';
import { AnalyticsScheduler } from './scheduler/analytics.scheduler';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { Public } from '@/common/decorators/public.decorator';

@Controller('analytics')
@ApiTags('Analytics (Admin / Debug)')
export class AnalyticsController {
  constructor(private readonly scheduler: AnalyticsScheduler, private readonly service: AnalyticsService) {}

  
  @Post('trigger-test')
  @Public()
  @ApiOperation({
    summary: 'Manually trigger daily analytics scheduling',
    description: `
⚠️ **Admin / Debug only**

This endpoint manually triggers the daily analytics scheduler.
It scans all active social profiles and enqueues analytics fetch jobs
into the BullMQ \`analytics-queue\`.
`,
  })
  @ApiResponse({
    status: 200,
    description: 'Analytics jobs were successfully scheduled',
    schema: {
      example: {
        message: 'Jobs scheduled successfully!',
      },
    },
  })
  @ApiResponse({
    status: 500,
    description: 'Scheduler failed while enqueueing analytics jobs',
  })
  async triggerTest() {
    console.log('👇 Manually triggering analytics job...');

    await this.scheduler.scheduleDailyFetch();

    return { message: 'Jobs scheduled successfully!' };
  }

  @Post('test')
  @Public()
@ApiOperation({
  summary: 'Manually fetch analytics for a single profile or post',
  description: `
⚠️ **Admin / Debug only**
This endpoint manually triggers analytics fetching logic for testing purposes.`,
})
@ApiBody({
  schema: {
    type: 'object',
    properties: {
      profileId: {
        type: 'string',
        example: 'cmkxyz123socialprofile',
        description: 'Internal SocialProfile ID',
      },
      postDestinationId: {
        type: 'string',
        example: 'cmkabc456post',
        description: 'Optional internal Post Destination ID to fetch analytics for',
      },
    },
  },
})
@ApiResponse({
  status: 200,
  description: 'Analytics fetch executed successfully',
  schema: {
    example: {
      message: 'Analytics fetch completed',
    },
  },
})
  @Post('test')
  async testFetch(@Body() body: {profileId: string; postDestinationId?: string } ){
    await this.service.testFetch(body)

  }
}
