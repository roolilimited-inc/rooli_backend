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

    // If super admin, we skip membership checks entirely
    if (user?.systemRole?.name === 'super_admin') {
      request.organizationId = orgId;
      return true; 
    }

    // Check Membership
    const membership = await this.prisma.organizationMember.findUnique({
      where: { 
        organizationId_userId: { organizationId: orgId, userId: user.id } 
      },
      select: { roleId: true, isActive: true }
    });

    if (!membership || !membership.isActive) {
      throw new UnauthorizedException('User is not a member of this organization');
    }

    // 3. Fetch Role (Fixed Signature)
    const role = await this.roleService.getRoleById(membership.roleId);

    //Attach to Request
    request.currentRole = role; 
    request.organizationId = orgId;

    return true;
  }
}