import {
  Controller,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  Get,
  Query,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { Response, Request } from 'express';
import { IncomingHttpHeaders } from 'http';
import { WebhookQueueService } from './queues/webhook-queue.service';
import { Public } from '@/common/decorators/public.decorator';
import { Platform } from '@generated/enums';

/**
 * Utility to flatten HTTP headers (convert string[] values to single string)
 */
function flattenHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key in headers) {
    const value = headers[key];
    if (Array.isArray(value)) {
      result[key] = value.join(', ');
    } else if (typeof value === 'string') {
      result[key] = value;
    } else if (typeof value === 'number') {
      result[key] = String(value);
    } else {
      result[key] = '';
    }
  }
  return result;
}

@Controller('webhooks')
@Public()
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly webhookService: WebhookService,
    private readonly webhookQueueService: WebhookQueueService,
  ) {}

  /**
   * GET endpoint for webhook verification (e.g., Meta's challenge request)
   * Platforms like Meta send GET requests to verify webhook endpoints during setup
   */
  @Get(':platform')
  @HttpCode(HttpStatus.OK)
  async handleVerification(
    @Param('platform') platform: string,
    @Query() query: any,
    @Res() res: Response,
  ): Promise<Response> {
    this.logger.debug(`[${platform}] Verification request received`);
    const platformEnum = platform.toUpperCase() as Platform;
    try {
      const challengeResponse = this.webhookService.handleVerificationRequest(
        platformEnum,
        query,
        null,
      );

      if (challengeResponse) {
        this.logger.log(`[${platform}] Verification successful`);
        return res.send(challengeResponse);
      }

      this.logger.warn(
        `[${platform}] Verification failed - no challenge response generated`,
      );
      return res.status(HttpStatus.FORBIDDEN).send('Verification failed');
    } catch (error) {
      this.logger.error(
        `[${platform}] Verification error: ${error.message}`,
        error.stack,
      );
      return res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .send('Internal server error');
    }
  }

  /**
   * POST endpoint for receiving webhook events
   * All processing happens asynchronously in the background via a queue.
   */
  @Post(':platform')
  @HttpCode(HttpStatus.OK)
  async handleWebhookEvent(
    @Param('platform') platform: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<Response> {
    const startTime = Date.now();
    this.logger.debug(`[${platform}] Webhook event received`);
    const platformEnum = platform.toUpperCase() as Platform;

    try {
      // Get raw body for signature verification (requires body-parser middleware)
      const rawBody = (req as any).rawBody;
      if (!rawBody) {
        this.logger.warn(
          `[${platform}] Raw body not available. Middleware configuration issue.`,
        );
        // Fallback to stringified JSON (less secure for signature verification)
        return this.handleWebhookWithoutRawBody(platformEnum, req, res);
      }

      // Flatten headers to handle string[] values
      const flattenedHeaders = flattenHeaders(req.headers);

      // 1. Verify signature synchronously (must be fast)
      const isValid = await this.webhookService.verifyWebhookSignature(
        platformEnum,
        rawBody,
        flattenedHeaders,
      );

      if (!isValid) {
        this.logger.warn(
          `[${platform}] Invalid webhook signature - possible tampering`,
        );
        // Still return 200 to prevent platform retries, but skip processing
        return res.send('EVENT_RECEIVED_INVALID_SIGNATURE');
      }

      // 2. Add to queue for asynchronous processing and return immediately
      await this.webhookQueueService.addWebhookJob({
        platform: platformEnum,
        rawBody,
        headers: flattenedHeaders,
        parsedBody: req.body,
      });

      const processingTime = Date.now() - startTime;
      this.logger.log(
        `[${platform}] Webhook verified and queued in ${processingTime}ms`,
      );

      return res.send('EVENT_RECEIVED_AND_QUEUED');
    } catch (error) {
      this.logger.error(
        `[${platform}] Webhook processing failed: ${error.message}`,
        error.stack,
      );

      // CRITICAL: Always return 200 OK even on errors
      // This prevents platforms from retrying webhook delivery
      return res.send('EVENT_RECEIVED');
    }
  }

  /**
   * Fallback handler for when raw body is not available
   * This is less secure but provides graceful degradation
   */
  private async handleWebhookWithoutRawBody(
    platform: Platform,
    req: Request,
    res: Response,
  ): Promise<Response> {
    this.logger.warn(
      `[${platform}] Using fallback processing without raw body`,
    );

    try {
      // Stringify the parsed body as a fallback (less secure for verification)
      const rawBody = JSON.stringify(req.body);
      const flattenedHeaders = flattenHeaders(req.headers);

      // Try verification with fallback raw body
      const isValid = await this.webhookService.verifyWebhookSignature(
        platform,
        rawBody,
        flattenedHeaders,
      );

      if (!isValid) {
        this.logger.warn(`[${platform}] Fallback verification failed`);
        return res.send('EVENT_RECEIVED_VERIFICATION_SKIPPED');
      }

      // Add to queue with fallback data
      await this.webhookQueueService.addWebhookJob({
        platform,
        rawBody,
        headers: flattenedHeaders,
        parsedBody: req.body,
      });

      this.logger.log(`[${platform}] Webhook queued via fallback method`);
      return res.send('EVENT_RECEIVED_AND_QUEUED');
    } catch (error) {
      this.logger.error(
        `[${platform}] Fallback processing failed: ${error.message}`,
      );
      return res.send('EVENT_RECEIVED');
    }
  }

  /**
   * Health check endpoint for webhook routes
   */
  @Get(':platform/health')
  @HttpCode(HttpStatus.OK)
  async healthCheck(
    @Param('platform') platform: Platform,
    @Res() res: Response,
  ): Promise<Response> {
    this.logger.debug(`[${platform}] Health check requested`);
    return res.json({
      status: 'ok',
      platform,
      timestamp: new Date().toISOString(),
      message: 'Webhook endpoint is operational',
    });
  }
}
