import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';

import {
  CancelResult,
  PlatformServiceMap,
  ScheduleResult,
} from '../interfaces/social-scheduler.interface';
import { FacebookPlatformService } from '../platforms/facebook-platform.service';
import { InstagramPlatformService } from '../platforms/instagram-platform.service';
import { Queue } from 'bullmq';
import { RETRY_CONFIG, ERROR_MESSAGES } from '../constants/scheduler.constants';
import { PreparePostService } from './prepare-post.service';
import { PostRepository } from './post-repo.service';
import { EncryptionService } from '@/common/utility/encryption.service';
import { PrismaService } from '@/prisma/prisma.service';
import { QueueService } from './queue.service';
import { Platform, PostStatus, ScheduleJobStatus } from '@generated/enums';
import { differenceInMilliseconds } from 'date-fns/differenceInMilliseconds';
import { LinkedInPlatformService } from '../platforms/linkedIn-platform.service';

@Injectable()
export class SocialSchedulerService {
  private readonly logger = new Logger(SocialSchedulerService.name);
  private readonly platformServices: PlatformServiceMap = {};
  private readonly maxRetryCount = RETRY_CONFIG.MAX_RETRIES;

  constructor(
    @InjectQueue('social-posting') private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly facebookService: FacebookPlatformService,
    private readonly encryptionService: EncryptionService,
    private readonly instagramService: InstagramPlatformService,
    private readonly linkedInService: LinkedInPlatformService,
    private readonly prepareService: PreparePostService,
    private readonly postRepo: PostRepository,
    private readonly queueService: QueueService,
  ) {
    this.registerPlatformServices();
  }

  private registerPlatformServices(): void {
    this.platformServices[Platform.FACEBOOK] = this.facebookService;
    this.platformServices[Platform.INSTAGRAM] = this.instagramService;
    this.platformServices[Platform.LINKEDIN] = this.linkedInService;

  }

  async schedulePost(postId: string): Promise<ScheduleResult> {
    try {
      const post = await this.postRepo.findById(postId);
      const preparedPost = await this.prepareService.preparePlatformPost(post);
      const platformService = this.resolvePlatformService(post);

      const delay = this.calculateDelay(post.scheduledAt);

      // STRATEGY: Native (Platform handles it) vs. Internal (BullMQ handles it)
      const useNativeScheduling = this.shouldUseNativeScheduling(preparedPost.platform, delay);

      if (useNativeScheduling) {
        // Facebook Native Flow
        const result = await platformService.schedulePost(preparedPost);
        await this.postRepo.updateFacebookScheduledPost(post.id, result.platformPostId);
        this.logger.log(`Scheduled Native (${post.platform}): ${result.platformPostId}`);
        return { success: true, jobId: result.platformPostId };
      } 
      else {
        // Internal Queue Flow (Instagram, X, LinkedIn, or FB Short-term)
        //  Pre-process (e.g., Create IG Container)
        // Platform service.schedulePost now returns { containerId } for IG, or nothing for others.
        const preResult = await platformService.schedulePost(preparedPost);
        
        // Add to BullMQ
        const job = await this.queueService.queueJob(post, delay);
        
        //  Update DB
        if (preResult?.containerId) {
           await this.postRepo.updateInstagramScheduledPost(post.id, String(job.id), preResult.containerId);
        } else {
           await this.postRepo.updateBullMQScheduledPost(post.id, String(job.id), post.platform);
        }

        this.logger.log(`Scheduled Internal (${post.platform}): Job ${job.id}, Delay ${delay}ms`);
        return { success: true, jobId: String(job.id) };
      }

    } catch (error) {
      return await this.handleSchedulingError(postId, error);
    }
  }
 
  async publishImmediately(postId: string): Promise<ScheduleResult> {
    return this.executePublish(postId, 'Immediate Publish');
  }

  async processScheduledPost(data: any): Promise<void> {
    const { postId } = data;
    await this.executePublish(postId, 'Scheduled Worker');
  }


  private async executePublish(postId: string, context: string): Promise<ScheduleResult> {
    try {
      const post = await this.postRepo.findById(postId);

      if (post.status === PostStatus.PUBLISHED || post.status === PostStatus.CANCELED) {
        this.logger.warn(`Skipping ${context}: Post ${postId} is ${post.status}`);
        return { success: false, error: 'Post status invalid' };
      }

      // Update Status to Processing
      await this.postRepo.updatePostStatus({
        postId,
        status: PostStatus.PUBLISHING,
        queueStatus: ScheduleJobStatus.PROCESSING,
      });

      // Prepare & Resolve
      const preparedPost = await this.prepareService.preparePlatformPost(post);
      const platformService = this.resolvePlatformService(post);

      //  Execute
      this.logger.log(`Executing ${context} for ${postId} on ${post.platform}`);
      const result = await platformService.publishImmediately(preparedPost);

      if (!result?.success) {
        throw new Error(result?.error || 'Publish operation failed');
      }

      // Success
      await this.postRepo.updatePublishedPost(post, result);
      this.logger.log(`Published ${postId} successfully. ID: ${result.platformPostId}`);
      
      return { success: true, jobId: result.platformPostId };

    } catch (error) {
      this.logger.error(`${context} failed for ${postId}`, error);
      return await this.handleSchedulingError(postId, error);
    }
  }

  async cancelScheduledPost(postId: string, organizationId: string): Promise<CancelResult> {
    try {
      const post = await this.postRepo.findById(postId, organizationId);
      
      if (!['SCHEDULED', 'FAILED'].includes(post.status)) {
         throw new BadRequestException('Cannot cancel this post status');
      }

      this.logger.log(`Cancelling Post ${postId}...`);

      // Run cleanup in parallel
      await Promise.allSettled([
        this.cancelPlatformResource(post), // Dynamic Platform Cancel
        this.queueService.removeJob(postId, post.jobId), // BullMQ Cancel
      ]);

      await this.postRepo.markPostAsCancelled(postId);

      return { success: true, message: 'Cancelled successfully' };
    } catch (error) {
      this.logger.error(`Cancellation error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Dynamically resolves the service and calls deleteScheduledPost
   */
  private async cancelPlatformResource(post: any): Promise<void> {
    try {
      // 1. Identify Resource ID (Container vs Native ID)
      const resourceId = post.metadata?.containerId || post.platformPostId;
      if (!resourceId) return; // Nothing to delete on platform

      const pageAccount = post.pageAccount;
      if (!pageAccount?.accessToken) return;

      const accessToken = await this.encryptionService.decrypt(pageAccount.accessToken);
      const service = this.resolvePlatformService(post);

      //  Call Interface Method
      await service.deleteScheduledPost(resourceId, accessToken);
      this.logger.log(`Deleted platform resource: ${resourceId}`);

    } catch (error) {
      this.logger.warn(`Failed to clean platform resource for ${post.id}: ${error.message}`);
      // Don't throw, we still want to cancel the DB record
    }
  }

  private resolvePlatformService(post: any) {
    // Handle the META split (FB vs IG)
    if (post.socialAccount?.platform === Platform.META) {
      return post.platform === Platform.INSTAGRAM 
        ? this.instagramService 
        : this.facebookService;
    }
    
    // Handle standard mapping
    const service = this.platformServices[post.socialAccount?.platform];
    if (!service) throw new Error(ERROR_MESSAGES.NO_PLATFORM_SERVICE(post.platform));
    
    return service;
  }

  private calculateDelay(scheduledAt: Date): number {
    if (!scheduledAt) return 0;
    const now = new Date();
    return Math.max(differenceInMilliseconds(new Date(scheduledAt), now), 0);
  }

  /**
   * Logic to determine if we use Native API or BullMQ
   */
  private shouldUseNativeScheduling(platform: string, delayMs: number): boolean {
    //  Only Facebook supports reliable native scheduling
    if (platform === Platform.FACEBOOK) {
      // Facebook Requirement: Must be > 10 minutes in future
      const tenMinutesMs = 10 * 60 * 1000;
      return delayMs > tenMinutesMs;
    }
    
    // Everyone else (IG, X, LinkedIn) uses Internal Queue
    return false;
  }

  private async handleSchedulingError(postId: string, error: any): Promise<ScheduleResult> {
    const msg = error.message || 'Unknown Error';
    this.logger.error(`Error on post ${postId}: ${msg}`);
    
    await this.prisma.post.update({
      where: { id: postId },
      data: {
        status: PostStatus.FAILED,
        errorMessage: msg.substring(0, 1000),
        queueStatus: ScheduleJobStatus.FAILED,
      },
    });

    return { success: false, error: msg };
  }
}
