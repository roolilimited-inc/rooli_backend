import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RoleService } from '@/access-control/services/roles.service';

@Injectable()
export class SocialAccountGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roleService: RoleService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const accountId = request.params.accountId || request.body.accountId;

    if (!accountId)
      throw new ForbiddenException('Social account ID not provided');

    const membership = await this.prisma.socialAccountMember.findUnique({
      where: {
        socialAccountId_userId: {
          socialAccountId: accountId,
          userId: user.id,
        },
      },
      select: { roleId: true, isActive: true },
    });

    if (!membership || !membership.isActive) {
      throw new UnauthorizedException(
        'User is not a member of this social account',
      );
    }

    // Hydrate the Role (fetch permissions)
    const role = await this.roleService.getRoleById(membership.roleId);


    // If the user has the System "Super Admin" role, bypass all checks.
    if (user?.systemRole?.name === 'super_admin') {
       return true; // Access Granted immediately
    }
    
    // Also check if the *current context role* is an owner (optional)
    if (role?.name === 'owner' && role?.isSystem) {
       return true; // Owners can do everything in their Org
    }


    // Attach to request for PermissionsGuard
    request.currentRole = role;
    request.socialAccountId = accountId;

    return true;
  }
}
