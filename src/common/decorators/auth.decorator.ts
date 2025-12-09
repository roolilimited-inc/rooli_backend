// decorators/auth.decorator.ts
import { applyDecorators, UseGuards } from '@nestjs/common';
import {  ApiForbiddenResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { OrganizationGuard } from '../guards/organization.guard';
import { SocialAccountGuard } from '../guards/social-account.guard';
import { RequirePermissions, RequiredPermission } from './permissions.decorator';
import { PermissionsGuard } from '../guards/permission.guard';

/**
 * Protects a route requiring Organization Membership.
 * automatically adds Swagger Auth docs and guards.
 */
export function OrgAuth(...permissions: RequiredPermission[]) {
  return applyDecorators(
    ApiUnauthorizedResponse({ description: 'Unauthorized / Session Expired' }),
    ApiForbiddenResponse({ description: 'Forbidden / Insufficient Permissions' }),

    // Set Metadata (if permissions are provided)
    RequirePermissions(...permissions),

    //  Verify Org Membership (OrganizationGuard)
    // Verify Specific Permissions (PermissionsGuard)
    UseGuards(OrganizationGuard, PermissionsGuard),
  );
}

/**
 * Protects a route requiring Social Account Membership.
 */
export function SocialAuth(...permissions: RequiredPermission[]) {
  return applyDecorators(
    ApiUnauthorizedResponse({ description: 'Unauthorized' }),
    ApiForbiddenResponse({ description: 'Forbidden' }),
    RequirePermissions(...permissions),
    UseGuards( SocialAccountGuard, PermissionsGuard),
  );
}