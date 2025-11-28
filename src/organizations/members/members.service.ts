import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { UpdateMemberDto } from './dtos/update-member.dto';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class MembersService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrganizationMembers(orgId: string, userId: string) {
    await this.verifyMembership(orgId, userId);

    const members = await this.prisma.organizationMember.findMany({
      where: {
        organizationId: orgId,
        isActive: true,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            avatar: true,
            lastActiveAt: true,
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });

    return members.map((m) => this.toSafeMember(m));
  }

  async updateMember(
    orgId: string,
    memberId: string,
    updaterId: string,
    dto: UpdateMemberDto,
  ) {
    const updaterMembership = await this.getMembership(orgId, updaterId);
    if (!updaterMembership || !this.isAdminOrOwner(updaterMembership)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    const targetMember = await this.getMembership(orgId, undefined, memberId);
    if (!targetMember) {
      throw new NotFoundException('Member not found');
    }

    if (this.isOwner(targetMember)) {
      throw new ForbiddenException('Cannot modify organization owner');
    }

    if (dto.roleId && !this.isOwner(updaterMembership)) {
      throw new ForbiddenException('Only owners can assign owner role');
    }

    const updated = await this.prisma.organizationMember.update({
      where: { id: memberId },
      data: {
        roleId: dto.roleId,
        isActive: dto.isActive,
        permissions: dto.permissions,
      },
      include: { user: true },
    });

    await this.logAuditEvent(orgId, updaterId, 'member_updated', {
      updatedMemberId: memberId,
      updates: dto,
    });

    return this.toSafeMember(updated);
  }

  async removeMember(orgId: string, memberId: string, removerId: string) {
    const removerMembership = await this.getMembership(orgId, removerId);
    if (!removerMembership || !this.isAdminOrOwner(removerMembership)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    const targetMember = await this.getMembership(orgId, undefined, memberId);
    if (!targetMember) {
      throw new NotFoundException('Member not found');
    }

    if (targetMember.userId === removerId) {
      throw new ConflictException('Cannot remove yourself from organization');
    }

    if (this.isOwner(targetMember)) {
      throw new ForbiddenException('Cannot remove organization owner');
    }

    const updatedMember = await this.prisma.organizationMember.update({
      where: { id: memberId },
      data: { isActive: false },
      include: { user: true },
    });

    await this.logAuditEvent(orgId, removerId, 'member_removed', {
      removedMemberId: memberId,
      removedMemberEmail: updatedMember.user?.email,
    });

    return this.toSafeMember(updatedMember);
  }

  async leaveOrganization(orgId: string, userId: string) {
    const membership = await this.getMembership(orgId, userId);
    if (!membership) {
      throw new NotFoundException('Membership not found');
    }

    if (this.isOwner(membership)) {
      throw new ForbiddenException(
        'Organization owner cannot leave. Transfer ownership first.',
      );
    }

    await this.prisma.organizationMember.update({
      where: { id: membership.id },
      data: { isActive: false },
    });

    await this.logAuditEvent(orgId, userId, 'member_left', {
      memberId: membership.id,
    });

    return { success: true, message: 'Successfully left organization' };
  }

  // --- Helpers ---

  private async getMembership(
    orgId: string,
    userId?: string,
    memberId?: string,
  ) {
    return this.prisma.organizationMember.findFirst({
      where: {
        organizationId: orgId,
        isActive: true,
        ...(userId && { userId }),
        ...(memberId && { id: memberId }),
      },
      include: { user: true, role: true },
    });
  }

  private isOwner(member: { role: { name: string } }) {
    return member.role?.name === 'OWNER';
  }

  private isAdminOrOwner(member: { role: { name: string } }) {
    return member.role?.name === 'ADMIN' || member.role?.name === 'OWNER';
  }

  private async verifyMembership(orgId: string, userId: string) {
    const membership = await this.getMembership(orgId, userId);
    if (!membership) {
      throw new ForbiddenException('Organization access denied');
    }
  }

  private async logAuditEvent(
    orgId: string,
    userId: string,
    action: string,
    details: any,
  ) {
    await this.prisma.auditLog.create({
      data: {
        organizationId: orgId,
        userId: userId,
        action: action,
        resourceType: 'member',
        details: details,
      },
    });
  }

  private toSafeMember(member: any) {
    return {
      id: member.id,
      role: member.role,
      isActive: member.isActive,
      permissions: member.permissions,
      joinedAt: member.joinedAt,
      lastActiveAt: member.lastActiveAt,
      user: member.user && {
        id: member.user.id,
        email: member.user.email,
        firstName: member.user.firstName,
        lastName: member.user.lastName,
        avatar: member.user.avatar,
      },
    };
  }
}
