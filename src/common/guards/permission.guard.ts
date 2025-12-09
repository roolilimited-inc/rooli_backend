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
 
    const requiredPermissions = this.reflector.getAllAndOverride<
      { resource: PermissionResource; action: PermissionAction }[]
    >(PERMISSION_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const role = request.currentRole;

    const user = request.user;
    if (user?.systemRole?.name === 'super_admin') {
       return true;
    }

    if (role?.name === 'owner' && role?.isSystem) {
       return true;
    }

    if (!role) {
      throw new ForbiddenException(
        'Security Context Missing: No role attached to request',
      );
    }

    const userPermissions = role.permissions.map((p) => p.permission);


    const hasAccess = requiredPermissions.every((required) =>
      userPermissions.some(
        (userPerm) =>
          userPerm.resource === required.resource &&
          userPerm.action === required.action,
      ),
    );

    if (!hasAccess) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
