import { PermissionResource, PermissionAction } from '@generated/enums';
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';


export const PERMISSION_KEY = 'permissions';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 1. Get Required Permissions from Decorator
    const requiredPermissions = this.reflector.getAllAndOverride<
      { resource: PermissionResource; action: PermissionAction }[]
    >(PERMISSION_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true; 
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    
    
    if (user?.systemRole?.name === 'super_admin') {
       return true; 
    }

    // -------------------------------------------------------------
    // 3. CONTEXT RESOLUTION (The "Current Role" Check)
    // -------------------------------------------------------------
    const role = request.currentRole;

    if (!role) {
      throw new ForbiddenException(
        'Security Context Missing: No active role found for this context.'
      );
    }

    // 4. CHECK 2: Context Owner (e.g., Org Owner or Workspace Owner)
    // Note: Ensure this explicitly checks for the 'OWNER' role specifically
    if (role.name === 'owner') { 
       return true;
    }


    // Optimization: Create a Set of permission strings like "POST:CREATE" for O(1) lookup
    // instead of nested loops.
    const userPermissionSet = new Set(
      role.permissions.map((p) => `${p.permission.resource}:${p.permission.action}`)
    );

    const hasAccess = requiredPermissions.every((required) => {
      const key = `${required.resource}:${required.action}`;
      return userPermissionSet.has(key);
    });

    if (!hasAccess) {
      throw new ForbiddenException(`Missing required permissions: ${requiredPermissions.map(p => p.action).join(', ')}`);
    }

    return true;
  }
}
