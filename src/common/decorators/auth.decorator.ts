// decorators/auth.decorator.ts
import { applyDecorators, UseGuards } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  RequirePermissions,
  RequiredPermission,
} from './permissions.decorator';
import { PermissionsGuard } from '../guards/permission.guard';
import { ContextGuard } from '../guards/context.guard';

/**
 * 1. ORGANIZATION LEVEL AUTH
 * Use this on routes with `:organizationId` or `:orgId`
 */
export function OrgAuth(...permissions: RequiredPermission[]) {
  return applyDecorators(
    ApiUnauthorizedResponse({ description: 'Session Expired' }),
    ApiForbiddenResponse({ description: 'Insufficient Permissions' }),

    // Set Permissions Metadata
    RequirePermissions(...permissions),

    // Chain: Auth -> Resolve Context (Org) -> Check Permission
    UseGuards(ContextGuard, PermissionsGuard),
  );
}

/**
 * 2. WORKSPACE LEVEL AUTH
 * Use this on routes with `:workspaceId` or `:wsId`
 */
export function WorkspaceAuth(...permissions: RequiredPermission[]) {
  return applyDecorators(
    ApiUnauthorizedResponse({ description: 'Session Expired' }),
    ApiForbiddenResponse({
      description: 'Insufficient Permissions for Workspace',
    }),

    RequirePermissions(...permissions),

    // Chain: Auth -> Resolve Context (Workspace) -> Check Permission
    // It's the SAME guard stack! ContextGuard handles the difference automatically.
    UseGuards(ContextGuard, PermissionsGuard),
  );
}
