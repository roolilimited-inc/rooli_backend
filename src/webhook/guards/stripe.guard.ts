import { Injectable, CanActivate, Logger, ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class StripeWebhookGuard implements CanActivate {
  private readonly logger = new Logger(StripeWebhookGuard.name);
  private stripe: Stripe;

  constructor(private readonly config: ConfigService) {
    this.stripe = new Stripe(config.get('STRIPE_SECRET_KEY'), { apiVersion: '2023-10-16' });
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { rawBody: Buffer }>();
    const signature = request.headers['stripe-signature'];

    if (!signature) {
      this.logger.error('Missing Stripe-Signature header');
      return false;
    }

    if (!request.rawBody) {
      this.logger.error('Raw body missing. Check main.ts config.');
      return false;
    }

    try {
      // This throws an error if signature is invalid
      this.stripe.webhooks.constructEvent(
        request.rawBody,
        signature,
        this.config.get('STRIPE_WEBHOOK_SECRET') // <--- Different from API Key!
      );
      return true;
    } catch (err) {
      this.logger.error(`Stripe Signature Verification Failed: ${err.message}`);
      return false;
    }
  }
}
