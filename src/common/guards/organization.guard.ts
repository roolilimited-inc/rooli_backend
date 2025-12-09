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
export class OrganizationGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roleService: RoleService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const orgId = request.params.orgId || request.body.orgId;

    if (!orgId) throw new ForbiddenException('Organization ID not provided');

    const membership = await this.prisma.organizationMember.findUnique({
      where: { 
        organizationId_userId: { organizationId: orgId, userId: user.id } 
      },
      select: { roleId: true, isActive: true }
    });

    // 2. Validate Membership
    if (!membership || !membership.isActive) {
      throw new UnauthorizedException('User is not a member of this organization');
    }

    const role = await this.roleService.getRoleById(membership.roleId, orgId);


    // If the user has the System "Super Admin" role, bypass all checks.
    if (user?.systemRole?.name === 'super_admin') {
       return true; // Access Granted immediately
    }
    
    // Also check if the *current context role* is an owner (optional)
    if (role?.name === 'owner' && role?.isSystem) {
       return true; // Owners can do everything in their Org
    }


    //  Attach to Request
    request.currentRole = role; 
    request.organizationId = orgId;

    return true;
  }
}