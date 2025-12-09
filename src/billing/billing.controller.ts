import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { BillingService } from './billing.service';
import { RecordUsageDto } from './dtos/usage-record.dto';
import {
  CreateCheckoutSessionDto,
  BillingPortalSessionDto,
} from './types/billing.types';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { OrganizationGuard } from '@/common/guards/organization.guard';

@Controller('billing')

export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    //private readonly stripeService: StripeService,
  ) {}

  @Post('checkout-session')
  createCheckoutSession(
    @Req() req,
    @Body() createCheckoutSessionDto: CreateCheckoutSessionDto,
  ) {
    return this.billingService.createCheckoutSession(
      req.organization.id,
      createCheckoutSessionDto,
    );
  }

  @Post('portal-session')
  createBillingPortalSession(
    @Req() req,
    @Body() billingPortalSessionDto: BillingPortalSessionDto,
  ) {
    return this.billingService.createBillingPortalSession(
      req.organization.id,
      billingPortalSessionDto,
    );
  }

  @Get('overview')
  getBillingOverview(@Req() req) {
    return this.billingService.getBillingOverview(req.organization.id);
  }

  @Post('usage')
  recordUsage(@Req() req, @Body() recordUsageDto: RecordUsageDto) {
    return this.billingService.recordUsage(req.organization.id, recordUsageDto);
  }

  // @Post('webhook')
  // @RawBodyResponse()
  // async handleWebhook(
  //   @Headers('stripe-signature') signature: string,
  //   @Body() rawBody: Buffer
  // ) {
  //   try {
  //     const event = this.stripeService.constructEvent(rawBody, signature);
  //     await this.billingService.handleWebhookEvent(event);
  //     return { received: true };
  //   } catch (error) {
  //     console.error('Webhook error:', error);
  //     throw new Error('Webhook signature verification failed');
  //   }
  // }
}
