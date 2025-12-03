import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Get,
} from '@nestjs/common';
import { SocialSchedulerService } from './services/social-scheduler.service';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@ApiTags('Social Scheduler')
@Controller('social-scheduler')
@ApiBearerAuth()
export class SocialSchedulerController {
  constructor(
    private readonly service: SocialSchedulerService,
  ) {}

  @Post(':postId/schedule')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Schedule a post',
    description:
      'Schedules a post (text, image, or video) to be published at a specific time on a Facebook Page using the Page access token.',
  })
  @ApiResponse({
    status: 201,
    description: 'Post successfully scheduled',
  })
  @ApiResponse({ status: 500, description: 'Failed to schedule post' })
  async schedulePost(@Param('postId') postId: string) {
    return this.service.schedulePost(postId);
  }

  @Post(':postId/publish')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Publish a post immediately',
    description:
      'Publishes a post (text, image, or video) instantly on a Facebook Page using the Page access token.',
  })
  @ApiResponse({
    status: 201,
    description: 'Post successfully published',
  })
  @ApiResponse({ status: 400, description: 'Invalid parameters' })
  @ApiResponse({ status: 500, description: 'Failed to publish post' })
  async publishImmediately(@Param('postId') postId: string) {
    return this.service.publishImmediately(postId);
  }

  @Delete(':postId/:organizationId/cancel')
  @ApiOperation({
    summary: 'Cancel a scheduled Facebook post',
    description: `
      Cancels (deletes) a scheduled post.
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'Scheduled post successfully cancelled.',
    schema: {
      example: {
        success: true,
        message: 'Scheduled post cancelled successfully.',
      },
    },
  })
  async cancelScheduledPost(
    @Param('postId') postId: string,
    @Param('organizationId') organizationId: string,
  ) {
    return this.service.cancelScheduledPost(postId, organizationId);
  }

}
