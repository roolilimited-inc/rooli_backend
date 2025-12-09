import slugify from 'slugify';
import { prisma} from './utils';
import { RoleScope } from '../../generated/prisma/client';

export const SYSTEM_ROLES = [
  {
    name: 'admin',
    displayName: 'Admin',
    description: 'Full system access',
    scope: RoleScope.SYSTEM,
    isSystem: true,
    isDefault: false,
    permissions: ['SYSTEM:SYSTEM:MANAGE'],
  },
  {
    name: 'user',
    displayName: 'User',
    description: 'Basic user access',
    scope: RoleScope.SYSTEM,
    isSystem: true,
    isDefault: true,
    permissions: ['ORGANIZATION:MEMBERS:READ'],
  },
  {
    name: 'owner',
    displayName: 'Owner',
    description: 'Full control of the organization',
    scope: RoleScope.ORGANIZATION,
    isSystem: true,
    isDefault: false,
    permissions: [
      'ORGANIZATION:ORGANIZATION:MANAGE',
      'ORGANIZATION:SETTINGS:UPDATE',
      'ORGANIZATION:BILLING:MANAGE',
      'ORGANIZATION:MEMBERS:CREATE',
      'ORGANIZATION:MEMBERS:MANAGE',
      'ORGANIZATION:MEMBERS:READ',
      'ORGANIZATION:INTEGRATION:MANAGE',
    ],
  },
];

export async function seedRoles(permissionMap: Map<string, string>) {
  for (const role of SYSTEM_ROLES) {
    let dbRole = await prisma.role.findFirst({
      where: { name: role.name, scope: role.scope, organizationId: null },
    });

    if (!dbRole) {
      dbRole = await prisma.role.create({
        data: {
          name: role.name,
          displayName: role.displayName,
          description: role.description,
          scope: role.scope,
          isSystem: role.isSystem,
          isDefault: role.isDefault ?? false,
          organizationId: null,
        },
      });
    }

    // Prepare role-permission mapping
    const rolePermissions = role.permissions
      .map((code) => {
        const id = permissionMap.get(code);
        return id ? { roleId: dbRole!.id, permissionId: id } : null;
      })
      .filter(Boolean);

    if (rolePermissions.length > 0) {
      await prisma.rolePermission.createMany({
        data: rolePermissions as any,
        skipDuplicates: true,
      });
    }
  }
}
