import { PlanFeatures } from '@/billing/types/billing.types';
import { SetMetadata } from '@nestjs/common';


export const FEATURE_KEY = 'required_feature';

export const RequireFeature = (feature: keyof PlanFeatures) => 
  SetMetadata(FEATURE_KEY, feature);