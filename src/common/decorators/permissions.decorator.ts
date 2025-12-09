
import { PermissionResource, PermissionAction } from '@generated/enums';
import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'permissions';

export interface RequiredPermission {
  resource: PermissionResource;
  action: PermissionAction;
}

export const RequirePermissions = (...permissions: RequiredPermission[]) =>
  SetMetadata(PERMISSION_KEY, permissions);