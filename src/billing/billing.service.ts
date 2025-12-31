import { PrismaService } from '@/prisma/prisma.service';
import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly PAYSTACK_BASE_URL = 'https://api.paystack.co';

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------
  // 1. GET AVAILABLE PLANS
  // ---------------------------------------------------------
  async getAvailablePlans() {
    return this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { price: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        price: true,
        currency: true,
        interval: true,
        features: true,
      },
    });
  }

  // ---------------------------------------------------------
  // 2. GET CURRENT SUBSCRIPTION
  // ---------------------------------------------------------
  async getSubscription(organizationId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { organizationId },
      include: { plan: true },
    });

    if (!subscription) return null;

    return {
      ...subscription,
      isActive:
        subscription.status === 'active' &&
        new Date() < subscription.currentPeriodEnd,
    };
  }

  // ---------------------------------------------------------
  // 3. INITIALIZE PAYMENT (Upgrade)
  // ---------------------------------------------------------
  async initializePayment(organizationId: string, planId: string, user: any) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    const email = org.billingEmail || user?.email;
    if (!email) {
      throw new BadRequestException('Billing email is required');
    }

    //  SWITCH LOGIC based on Gateway
    if (org.subscriptionGateway === 'PAYSTACK') {
      return this.initializePaystack(org, plan, email);
    } else {
      return this.initializeStripe(org, plan, email);
    }
  }

  // ---------------------------------------------------------
  //  ACTIVATE SUBSCRIPTION (charge.success)
  // ---------------------------------------------------------
  async activateSubscription(payload: any) {
    const data = payload.data;
    const { reference, amount, currency, metadata, plan, authorization, id } =
      data;

    // 1. Identify Organization
    const organizationId = metadata?.organizationId;
    if (!organizationId) {
      this.logger.error(
        `Paystack charge missing organizationId in metadata: ${reference}`,
      );
      return;
    }

    // 2. Identify Plan
    // Paystack sends the plan object inside 'data' if it was a plan charge
    const paystackPlanCode = plan?.plan_code;
    if (!paystackPlanCode) {
      this.logger.error(`Charge ${reference} does not belong to a plan`);
      return;
    }

    const localPlan = await this.prisma.plan.findUnique({
      where: { paystackPlanCode },
    });

    if (!localPlan) {
      this.logger.error(`Unknown Paystack Plan Code: ${paystackPlanCode}`);
      return;
    }

    // 3. Calculate Dates
    const startDate = new Date();
    const endDate = new Date();
    if (localPlan.interval === 'yearly') {
      endDate.setFullYear(endDate.getFullYear() + 1);
    } else {
      endDate.setMonth(endDate.getMonth() + 1);
    }

    // 4. DB Transaction
    return this.prisma.$transaction(async (tx) => {
      // Upsert Subscription
      // We might not have the emailToken yet (it comes in a separate event),
      // so we only update what we have.
      await tx.subscription.upsert({
        where: { organizationId },
        create: {
          organizationId,
          planId: localPlan.id,
          status: 'active',
          currentPeriodStart: startDate,
          currentPeriodEnd: endDate,
          authorizationCode: authorization?.authorization_code,
          // We will fill paystackSubscriptionCode and emailToken via 'subscription.create' event
        },
        update: {
          planId: localPlan.id,
          status: 'active',
          currentPeriodStart: startDate,
          currentPeriodEnd: endDate,
          authorizationCode: authorization?.authorization_code,
          cancelAtPeriodEnd: false,
        },
      });

      // Log Transaction
      await tx.transaction.create({
        data: {
          organizationId,
          txRef: reference,
          providerTxId: id.toString(),
          provider: 'PAYSTACK',
          amount: Number(amount) / 100, // Convert Kobo to Naira
          currency,
          status: 'successful',
          paymentDate: new Date(),
        },
      });

      // Unlock Org
      await tx.organization.update({
        where: { id: organizationId },
        data: { status: 'ACTIVE', isActive: true },
      });
    });
  }

  // ---------------------------------------------------------
  // 5. SYNC SUBSCRIPTION DETAILS (subscription.create)
  // ---------------------------------------------------------
  async saveSubscriptionDetails(payload: any) {
    const data = payload.data;
    const { subscription_code, email_token, customer } = data;

    // Find the Org by customer email since metadata might not be in this specific event
    const org = await this.prisma.organization.findFirst({
      where: { billingEmail: customer.email },
    });

    if (!org) return;

    await this.prisma.subscription.update({
      where: { organizationId: org.id },
      data: {
        paystackSubscriptionCode: subscription_code,
        emailToken: email_token, // <--- CRITICAL for cancellation
      },
    });
    this.logger.log(`Synced Paystack Subscription Details for ${org.name}`);
  }

  // ---------------------------------------------------------
  // 6. CANCEL SUBSCRIPTION
  // ---------------------------------------------------------
  async cancelSubscription(organizationId: string) {
    const sub = await this.prisma.subscription.findUnique({
      where: { organizationId },
    });

    if (!sub?.paystackSubscriptionCode || !sub?.emailToken) {
      throw new BadRequestException(
        'Missing subscription credentials (Code/Token)',
      );
    }

    try {
      await firstValueFrom(
        this.httpService.post(
          `${this.PAYSTACK_BASE_URL}/subscription/disable`,
          {
            code: sub.paystackSubscriptionCode,
            token: sub.emailToken,
          },
          {
            headers: {
              Authorization: `Bearer ${this.config.get('PAYSTACK_SECRET_KEY')}`,
            },
          },
        ),
      );

      return this.prisma.subscription.update({
        where: { organizationId },
        data: { status: 'cancelled', cancelAtPeriodEnd: true },
      });
    } catch (e) {
      this.logger.error(e.response?.data);
      throw new BadRequestException('Cancellation failed');
    }
  }

  async handleFailedPayment(paystackData: any) {
    const { reference, amount, currency, metadata, gateway_response, id } =
      paystackData;
    const organizationId = metadata?.organizationId;

    if (!organizationId) return;

    // Log the failure
    await this.prisma.transaction.create({
      data: {
        organizationId,
        txRef: reference,
        providerTxId: id.toString(),
        provider: 'PAYSTACK',
        amount: Number(amount) / 100,
        currency: currency || 'NGN',
        status: 'failed',
        paymentDate: new Date(),
      },
    });

    this.logger.warn(`Payment failed: ${gateway_response}`);
  }

  async handleSubscriptionFailure(payload: any) {
    const data = payload.data;
    // Paystack sends the subscription_code or email in the payload
    const subscriptionCode = data.subscription_code;

    if (!subscriptionCode) return;

    // Downgrade the Org immediately
    await this.prisma.subscription.updateMany({
      where: { paystackSubscriptionCode: subscriptionCode },
      data: {
        status: 'past_due', // OR 'cancelled'
        isActive: false, // This triggers your Guards to block access
      },
    });

    // Optional: Send email to user "Your payment failed"
    this.logger.warn(`Subscription marked past_due: ${subscriptionCode}`);
  }

  async verifyPayment(reference: string) {
    // 1. FAST CHECK: Did the webhook already finish the job?
    const existingTx = await this.prisma.transaction.findUnique({
      where: { txRef: reference },
    });

    if (existingTx && existingTx.status === 'successful') {
      return { status: 'success', message: 'Payment already verified' };
    }

    // 1. Call Paystack API to check status
    const { data } = await firstValueFrom(
      this.httpService.get(
        `https://api.paystack.co/transaction/verify/${reference}`,
        {
          headers: {
            Authorization: `Bearer ${this.config.get('PAYSTACK_SECRET_KEY')}`,
          },
        },
      ),
    );

    const status = data.data.status; // 'success', 'failed', 'abandoned'
    const metadata = data.data.metadata;

    if (status === 'success') {
      // It's possible the Webhook hasn't arrived yet.
      // You can either wait for webhook OR just activate here if you trust the API call.
      // Ideally, let the webhook handle activation to avoid race conditions,
      // or use a distributed lock.
      return { status: 'pending_webhook' };
    }

    if (status === 'failed' || status === 'abandoned') {
      // 🚨 THIS IS WHERE YOU CATCH THE DECLINE
      await this.handleFailedPayment({
        data: data.data, // Pass the full transaction object
      });

      throw new BadRequestException('Payment failed or was declined');
    }

    return data.data;
  }

  private async initializePaystack(org: any, plan: any, email: string) {
    const reference = `rooli_${org.id}_${Date.now()}`;

    // Use the NGN price from the Plan model
    const amountInKobo = Number(plan.priceNgn) * 100;

    const payload = {
      email,
      amount: amountInKobo,
      plan: plan.paystackPlanCode,
      reference,
      metadata: {
        organizationId: org.id,
        targetPlanId: plan.id,
        gateway: 'PAYSTACK',
      },
      callback_url: `${this.config.get('CALLBACK_URL')}`,
    };

    try {
      const { data } = await firstValueFrom(
        this.httpService.post(
          `${this.PAYSTACK_BASE_URL}/transaction/initialize`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${this.config.get('PAYSTACK_SECRET_KEY')}`,
            },
          },
        ),
      );
      return { paymentUrl: data.data.authorization_url, reference };
    } catch (error) {
      this.logger.error('Paystack Init Error', error.response?.data);
      throw new BadRequestException('Paystack initialization failed');
    }
  }

  // --- Helper: Stripe Logic ---
  private async initializeStripe(org: any, plan: any, email: string) {
    const stripe = new Stripe(this.config.get('STRIPE_SECRET_KEY'), {
      apiVersion: '2023-10-16',
    });

    try {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'subscription', // or 'payment' for one-time
        customer_email: email,
        line_items: [
          {
            price: plan.stripePriceId, // You must create this Price ID in Stripe Dashboard first
            quantity: 1,
          },
        ],
        success_url: `${this.config.get('FRONTEND_URL')}/dashboard?success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${this.config.get('FRONTEND_URL')}/pricing?canceled=true`,
        subscription_data: {
          metadata: {
            organizationId: org.id,
            targetPlanId: plan.id,
          },
        },
        metadata: {
    organizationId: org.id, 
  },
      });

      return {
        paymentUrl: session.url,
        reference: session.id, // Stripe Session ID acts as reference
      };
    } catch (error) {
      this.logger.error('Stripe Init Error', error);
      throw new BadRequestException('Stripe initialization failed');
    }
  }

  // ---------------------------------------------------------
  // A. ACTIVATE (First Time)
  // ---------------------------------------------------------
  async activateStripeSubscription(session: any) {
    const { metadata, subscription, customer_email } = session;
    const organizationId = metadata?.organizationId;
    const planId = metadata?.targetPlanId; // We passed this in initializeStripe

    if (!organizationId || !planId) throw new Error('Missing metadata in Stripe Session');

    // Fetch the Stripe Subscription details to get dates
    const stripe = new Stripe(this.config.get('STRIPE_SECRET_KEY'), { apiVersion: '2023-10-16' });
    const subDetails = await stripe.subscriptions.retrieve(subscription as string);

    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.upsert({
        where: { organizationId },
        create: {
          organizationId,
          planId,
          status: 'active',
          currentPeriodStart: new Date(subDetails.current_period_start * 1000), // Stripe uses Unix timestamps
          currentPeriodEnd: new Date(subDetails.current_period_end * 1000),
          stripeSubscriptionId: subDetails.id,
          stripeCustomerId: subDetails.customer as string,
        },
        update: {
          planId,
          status: 'active',
          currentPeriodStart: new Date(subDetails.current_period_start * 1000),
          currentPeriodEnd: new Date(subDetails.current_period_end * 1000),
          stripeSubscriptionId: subDetails.id,
          cancelAtPeriodEnd: false,
        }
      });

      await tx.organization.update({
        where: { id: organizationId },
        data: { status: 'ACTIVE', isActive: true }
      });
    });
  }

  // ---------------------------------------------------------
  // B. RENEW (Recurring)
  // ---------------------------------------------------------
  async renewStripeSubscription(invoice: any) {
    // Invoices might not have metadata, so we find the org via the Stripe Subscription ID
    const stripeSubscriptionId = invoice.subscription;

    const existingSub = await this.prisma.subscription.findUnique({
      where: { stripeSubscriptionId },
    });

    if (!existingSub) {
      this.logger.warn(`Orphaned Stripe Invoice for sub: ${stripeSubscriptionId}`);
      return null;
    }

    // Update Dates
    // invoice.lines.data[0].period.end is usually available
    const periodEnd = new Date(invoice.lines.data[0].period.end * 1000);

    await this.prisma.subscription.update({
      where: { id: existingSub.id },
      data: {
        status: 'active',
        currentPeriodEnd: periodEnd,
      }
    });

    // Log the transaction
    await this.prisma.transaction.create({
      data: {
        organizationId: existingSub.organizationId,
        provider: 'STRIPE',
        amount: invoice.amount_paid / 100,
        currency: invoice.currency,
        status: 'successful',
        txRef: invoice.id,
      }
    });

    return existingSub.organizationId;
  }

  // ---------------------------------------------------------
  // C. DEACTIVATE (Churn)
  // ---------------------------------------------------------
  async deactivateStripeSubscription(sub: any) {
    const stripeSubscriptionId = sub.id;

    await this.prisma.subscription.update({
      where: { stripeSubscriptionId },
      data: { status: 'cancelled', isActive: false }
    });
  }
}
