import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

import {
  RoleScope,
  PermissionScope,
  PermissionResource,
  PermissionAction,
} from '@generated/enums';
import { Prisma } from '@generated/client';
import { RoleWithPermissions } from '../interfaces/index.interfaces';
import { CreateRoleDto } from '../dtos/create-role.dto';
import slugify from 'slugify';
import { UpdateRoleDto } from '../dtos/update-role.dto';

//Cache role → permissions (in-memory/Redis) for fast permission checks, with invalidation after role updates.

@Injectable()
export class RoleService {
  private readonly logger = new Logger(RoleService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createRole(createRoleDto: CreateRoleDto): Promise<RoleWithPermissions> {
    const {
      name,
      description,
      displayName,
      scope,
      organizationId,
      permissionIds = [],
      isDefault = false,
      isSystem = false,
    } = createRoleDto;

    const slug = slugify(name, { lower: true, strict: true });

    // Validate organization context early
    if (scope === RoleScope.ORGANIZATION && !organizationId && !isSystem) {
      throw new ConflictException(
        'Organization ID is required for organization-scoped roles',
      );
    }

    // Ensure default role unset and role creation happen in same transaction
    try {
      return await this.prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          // If setting as default, unset any existing default within same tx
          if (isDefault) {
            await this.unsetExistingDefaultRole(
              scope,
              organizationId || null,
              tx,
            );
          }

          const role = await tx.role.create({
            data: {
              name,
              slug,
              description,
              displayName,
              scope,
              organizationId: scope === RoleScope.ORGANIZATION ? organizationId : null,
              isDefault,
              isSystem,
            },
          });

          // Assign permissions if provided (use the same tx)
          if (permissionIds.length > 0) {
            await this.assignPermissionsToRole(role.id, permissionIds, tx);
          }

          return this.findRoleWithPermissions(role.id, tx);
        },
      );
    } catch (err) {
      // Convert Prisma unique-constraint into friendly conflict
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // optional: log details
        this.logger.warn('Role uniqueness violation on create', {
          name,
          scope,
          organizationId,
        });
        throw new ConflictException(
          `Role with name "${name}" already exists in this scope`,
        );
      }
      throw err;
    }
  }

  async findRoleWithPermissions(
    roleId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<RoleWithPermissions> {
    const prisma = (tx as Prisma.TransactionClient) || this.prisma;

    const role = await prisma.role.findUnique({
      where: { id: roleId },
      include: {
        permissions: {
          include: {
            permission: true,
          },
        },
      },
    });

    if (!role) {
      throw new NotFoundException(`Role with ID ${roleId} not found`);
    }

    return {
      ...role,
      permissions: role.permissions.map((rp) => rp.permission),
    };
  }

  async updateRole(
    roleId: string,
    updateRoleDto: UpdateRoleDto,
  ): Promise<RoleWithPermissions> {
    const { name, description, displayName, permissionIds, isDefault } =
      updateRoleDto;

    const existingRole = await this.prisma.role.findUnique({
      where: { id: roleId },
    });

    if (!existingRole) {
      throw new NotFoundException(`Role with ID ${roleId} not found`);
    }

    if (existingRole.isSystem) {
      throw new ForbiddenException('Cannot modify system roles');
    }

    // Check for name conflict
    if (name && name !== existingRole.name) {
      const nameExists = await this.prisma.role.findFirst({
        where: {
          name,
          scope: existingRole.scope,
          organizationId: existingRole.organizationId,
          id: { not: roleId },
        },
      });

      if (nameExists) {
        throw new ConflictException(
          `Role with name "${name}" already exists in this scope`,
        );
      }
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Handle default role setting
      if (isDefault && !existingRole.isDefault) {
        await this.unsetExistingDefaultRole(
          existingRole.scope,
          existingRole.organizationId,
          tx,
        );
      }

      // prepare update payload and slug if name changed
      const updateData: any = {
        ...(description !== undefined && { description }),
        ...(displayName !== undefined && { displayName }),
        ...(isDefault !== undefined && { isDefault }),
      };

      if (name && name !== existingRole.name) {
        updateData.name = name;
        updateData.slug = slugify(name, { lower: true, strict: true });
      }

      // Update role
      await tx.role.update({
        where: { id: roleId },
        data: updateData,
      });

      // Update permissions if provided (use same tx)
      if (permissionIds) {
        await this.setRolePermissions(roleId, permissionIds, tx);
      }

      // Return fully populated role (including permissions) using same tx
      return this.findRoleWithPermissions(roleId, tx);
    });
  }

  async assignPermissionsToRole(
    roleId: string,
    permissionIds: string[],
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const prisma = tx || this.prisma;

    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role) {
      throw new NotFoundException(`Role with ID ${roleId} not found`);
    }

    // Load permissions and validate existence
    const permissions = await prisma.permission.findMany({
      where: { id: { in: permissionIds } },
    });

    if (permissions.length !== permissionIds.length) {
      throw new NotFoundException('One or more permissions not found');
    }

    // Check scope compatibility using helper to avoid enum mismatch
    const invalid = permissions.find(
      (p) => !this.permissionScopeMatchesRole(role.scope, p.scope),
    );
    if (invalid) {
      throw new ConflictException(
        `Permission scope ${invalid.scope} does not match role scope ${role.scope}`,
      );
    }

    // Create role-permission relationships in bulk (skip duplicates)
    await prisma.rolePermission.createMany({
      data: permissionIds.map((permissionId) => ({
        roleId,
        permissionId,
      })),
      skipDuplicates: true,
    });
  }

  async setRolePermissions(
    roleId: string,
    permissionIds: string[],
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const prisma = tx || this.prisma;

    await prisma.rolePermission.deleteMany({
      where: { roleId },
    });

    if (permissionIds.length > 0) {
      await this.assignPermissionsToRole(roleId, permissionIds, tx);
    }
  }

  async deleteRole(roleId: string): Promise<void> {
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      select: { id: true, isSystem: true },
    });

    if (!role) {
      throw new NotFoundException(`Role with ID ${roleId} not found`);
    }

    if (role.isSystem) {
      throw new ForbiddenException('Cannot delete system roles');
    }

    const orgMemberCount = await this.prisma.organizationMember.count({
      where: { roleId },
    });
    const saMemberCount = await this.prisma.socialAccountMember.count({
      where: { roleId },
    });
    if (orgMemberCount > 0 || saMemberCount > 0) {
      throw new ConflictException(
        'Cannot delete role that is assigned to members',
      );
    }

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      await tx.role.delete({ where: { id: roleId } });
    });
  }

  async findOrganizationRoles(
    organizationId: string,
  ): Promise<RoleWithPermissions[]> {
    const roles = await this.prisma.role.findMany({
      where: {
        scope: RoleScope.ORGANIZATION,
        organizationId,
      },
      include: {
        permissions: {
          include: {
            permission: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return roles.map((role) => ({
      ...role,
      permissions: role.permissions.map((rp) => rp.permission),
    }));
  }

  async findSystemRoles(scope?: RoleScope): Promise<RoleWithPermissions[]> {
    const where: any = { isSystem: true };
    if (scope) {
      where.scope = scope;
    }

    const roles = await this.prisma.role.findMany({
      where,
      include: {
        permissions: {
          include: {
            permission: true,
          },
        },
      },
    });

    return roles.map((role) => ({
      ...role,
      permissions: role.permissions.map((rp) => rp.permission),
    }));
  }

  async getDefaultRole(
    scope: RoleScope,
    organizationId?: string,
  ): Promise<RoleWithPermissions | null> {
    const where: any = {
      scope,
      isDefault: true,
    };

    if (scope === RoleScope.ORGANIZATION) {
      where.organizationId = organizationId;
    } else {
      where.organizationId = null;
    }

    const role = await this.prisma.role.findFirst({
      where,
      include: {
        permissions: {
          include: {
            permission: true,
          },
        },
      },
    });

    if (!role) return null;

    return {
      ...role,
      permissions: role.permissions.map((rp) => rp.permission),
    };
  }
  private async unsetExistingDefaultRole(
    scope: RoleScope,
    organizationId?: string | null,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const prisma = tx || this.prisma;

    const where: any = {
      scope,
      isDefault: true,
    };

    if (scope === RoleScope.ORGANIZATION) {
      where.organizationId = organizationId;
    } else {
      where.organizationId = null;
    }

    await prisma.role.updateMany({
      where,
      data: { isDefault: false },
    });
  }

  private permissionScopeMatchesRole(
    roleScope: RoleScope,
    permScope: PermissionScope,
  ): boolean {
    if (
      roleScope === RoleScope.ORGANIZATION &&
      permScope === PermissionScope.ORGANIZATION
    )
      return true;
    if (
      roleScope === RoleScope.SOCIAL_ACCOUNT &&
      permScope === PermissionScope.SOCIAL_ACCOUNT
    )
      return true;
    return false;
  }
}
