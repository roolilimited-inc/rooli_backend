import {
  BillingInterval,
  PlanTier,
  Prisma,
} from '../../generated/prisma/client';
import { prisma } from './utils';

export async function seedPlans() {
  const plans: Prisma.PlanCreateInput[] = [
    // ==========================================
    // 1. CREATOR PLAN
    // ==========================================
    {
      name: 'Creator Monthly',
      description: 'For creators, solo founders, freelancers & small brands.',
      tier: PlanTier.CREATOR,
      priceNgn: 7350.0,
      priceUsd: 5.0,
      interval: BillingInterval.MONTHLY,
      maxWorkspaces: 1,
      maxSocialAccountsPerWorkspace: 3,
      maxTeamMembers: 1,
      monthlyAiCredits: 50,
      features: JSON.stringify({
        canRemoveBranding: false,
        advancedAnalytics: false,
        mediaLibrary: true,
      }),
      isActive: true,
      paystackPlanCode: 'PLN_u9jzjn5g3as3wk8',
      stripePriceId: 'prod_ThCNfADGQoP3IR',
    },
    {
      name: 'Creator Annual',
      description:
        'Annual - For creators, solo founders, freelancers & small brands.',
      tier: PlanTier.CREATOR,
      priceNgn: 83790.0,
      priceUsd: 57.0,
      interval: BillingInterval.YEARLY,
      maxWorkspaces: 1,
      maxSocialAccountsPerWorkspace: 3,
      maxTeamMembers: 1,
      monthlyAiCredits: 50,
      features: JSON.stringify({
        canRemoveBranding: false,
        advancedAnalytics: false,
        mediaLibrary: true,
      }),
      isActive: true,
      paystackPlanCode: 'PLN_tf507aah9h9a3tf',
      stripePriceId: 'prod_ThYI0CNNSgPdCt',
    },
    // ==========================================
    // 2. BUSINESS PLAN
    // ==========================================
    {
      name: 'Business Monthly',
      description: 'For growing businesses & small teams.',
      tier: PlanTier.BUSINESS, // Changed from CREATOR to BUSINESS
      priceNgn: 14700.0,
      priceUsd: 10.0,
      interval: BillingInterval.MONTHLY,
      maxWorkspaces: 1,
      maxSocialAccountsPerWorkspace: 4,
      maxTeamMembers: 3,
      monthlyAiCredits: 1000,
      features: JSON.stringify({
        canRemoveBranding: true,
        advancedAnalytics: true,
        approvalWorkflow: true,
        bulkScheduling: true,
        visualCalendar: true,
      }),
      isActive: true,
      paystackPlanCode: 'PLN_y8l5ovjzqx6bo5j',
      stripePriceId: 'prod_ThCTpAiM46VAcY',
    },
    {
      name: 'Business Annual',
      description: 'Annual - For growing businesses & small teams.',
      tier: PlanTier.BUSINESS,
      priceNgn: 167580.0,
      priceUsd: 114.0,
      interval: BillingInterval.YEARLY,
      maxWorkspaces: 1,
      maxSocialAccountsPerWorkspace: 4,
      maxTeamMembers: 3,
      monthlyAiCredits: 1000,
      features: JSON.stringify({
        canRemoveBranding: true,
        advancedAnalytics: true,
        approvalWorkflow: true,
        bulkScheduling: true,
        visualCalendar: true,
      }),
      isActive: true,
      paystackPlanCode: 'PLN_j2dz1p5g4zima6a',
      stripePriceId: 'prod_ThYKeKpSURqf5a',
    },
    // ==========================================
    // 3. ROCKET PLAN
    // ==========================================
    {
      name: 'Rocket Monthly',
      description: 'For agencies & companies with large social media teams.',
      tier: PlanTier.ROCKET,
      priceNgn: 44100.0,
      priceUsd: 30.0,
      interval: BillingInterval.MONTHLY,
      maxWorkspaces: 5,
      maxSocialAccountsPerWorkspace: 4,
      maxTeamMembers: 9999,
      monthlyAiCredits: 5000,
      features: JSON.stringify({
        canRemoveBranding: true,
        advancedAnalytics: true,
        approvalWorkflow: true,
        whiteLabelReports: true,
        clientLabels: true,
        prioritySupport: true,
      }),
      isActive: true,
      paystackPlanCode: 'PLN_of4tu83cw2og4s5',
      stripePriceId: 'prod_ThCVVvDvadnRRF',
    },
    {
      name: 'Rocket Annual',
      description:
        'Annual - For agencies & companies with large social media teams.',
      tier: PlanTier.ROCKET,
      priceNgn: 502740.0,
      priceUsd: 342.0,
      interval: BillingInterval.YEARLY,
      maxWorkspaces: 5,
      maxSocialAccountsPerWorkspace: 4,
      maxTeamMembers: 9999,
      monthlyAiCredits: 5000,
      features: JSON.stringify({
        canRemoveBranding: true,
        advancedAnalytics: true,
        approvalWorkflow: true,
        whiteLabelReports: true,
        clientLabels: true,
        prioritySupport: true,
      }),
      isActive: true,
      paystackPlanCode: 'PLN_oiwln4pt1wxbw61',
      stripePriceId: 'prod_ThYMXz0klEnofu',
    },
    // ==========================================
    // 4. ENTERPRISE PLAN
    // ==========================================
    {
      name: 'Enterprise',
      description:
        'For large organizations with advanced needs. Contact Sales.',
      tier: PlanTier.ENTERPRISE,
      priceNgn: 294000.0,
      priceUsd: 200.0,
      interval: BillingInterval.MONTHLY,
      maxWorkspaces: 10,
      maxSocialAccountsPerWorkspace: 10,
      maxTeamMembers: 9999,
      monthlyAiCredits: 10000,
      features: JSON.stringify({
        dedicatedSupport: true,
        sla: true,
        customOnboarding: true,
      }),
      isActive: false, // Usually not selectable in self-serve
      paystackPlanCode: 'PLN_50f99tizrj3mp5m',
      stripePriceId: 'prod_ThCj7AZy4hnuu3',
    },
  ];
  await prisma.$transaction(async (tx) => {
    for (const plan of plans) {
      await tx.plan.upsert({
        where: { name: plan.name }, // Use name as unique identifier
        update: plan,
        create: plan,
      });
    }
  });

  console.log('Plans seeded successfully');
}
