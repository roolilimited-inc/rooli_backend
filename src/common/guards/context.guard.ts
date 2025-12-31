import { PrismaService } from '@/prisma/prisma.service';
import { 
  Injectable, 
  CanActivate, 
  ExecutionContext, 
  ForbiddenException 
} from '@nestjs/common';

@Injectable()
export class ContextGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    
    // 1. Safety Check: AuthGuard must run first
    if (!user || !user.userId) return true;

    const params = request.params;
    const workspaceId = params.workspaceId || params.wsId;
    const organizationId = params.organizationId || params.orgId;

    // ====================================================
    // SCENARIO A: User is accessing a WORKSPACE
    // ====================================================
    if (workspaceId) {
      const member = await this.prisma.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: workspaceId,
            userId: user.userId,
          },
        },
        include: {
          role: {
            include: { permissions: { include: { permission: true } } },
          },
        },
      });

      if (!member) {
        throw new ForbiddenException('You are not a member of this workspace.');
      }

      // ATTACH CONTEXT
      request.currentContext = 'WORKSPACE';
      request.currentRole = member.role;
      request.currentMember = member;
      
      return true;
    }

    // ====================================================
    // SCENARIO B: User is accessing an ORGANIZATION (Billing/Settings)
    // ====================================================


    if (organizationId) {
      const member = await this.prisma.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: organizationId,
            userId: user.userId,
          },
        },
        include: {
          role: {
            include: { permissions: { include: { permission: true } } },
          },
          organization: { select: { status: true } }
        },
      });

      if (!member) {
        throw new ForbiddenException('You are not a member of this organization.');
      }

      if (member.organization.status === 'SUSPENDED') {
      throw new ForbiddenException('This organization has been suspended.');
  }

      // ATTACH CONTEXT
      request.currentContext = 'ORGANIZATION';
      request.currentRole = member.role;
      request.currentMember = member;

      return true;
    }

    // ====================================================
    // SCENARIO C: No Context (e.g. /users/me)
    // ====================================================
    // We don't attach a role, so PermissionsGuard will rely on System Roles 
    // or throw an error if a role was strictly required.
    return true;
  }
}