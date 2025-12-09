import { prisma } from './utils';
import {
  PermissionAction,
  PermissionResource,
  PermissionScope,
} from '../../generated/prisma/client';

export const SYSTEM_PERMISSIONS = [
  // SYSTEM
  {
    name: 'Manage System',
    scope: PermissionScope.SYSTEM,
    resource: PermissionResource.SYSTEM,
    action: PermissionAction.MANAGE,
  },

  // ORGANIZATION
  {
    name: 'Manage Organization',
    scope: PermissionScope.ORGANIZATION,
    resource: PermissionResource.ORGANIZATION,
    action: PermissionAction.MANAGE,
  },
  {
    name: 'Update Settings',
    scope: PermissionScope.ORGANIZATION,
    resource: PermissionResource.SETTINGS,
    action: PermissionAction.UPDATE,
  },
  {
    name: 'Manage Billing',
    scope: PermissionScope.ORGANIZATION,
    resource: PermissionResource.BILLING,
    action: PermissionAction.MANAGE,
  },
  {
    name: 'Invite Members',
    scope: PermissionScope.ORGANIZATION,
    resource: PermissionResource.MEMBERS,
    action: PermissionAction.CREATE,
  },
  {
    name: 'Manage Members',
    scope: PermissionScope.ORGANIZATION,
    resource: PermissionResource.MEMBERS,
    action: PermissionAction.MANAGE,
  },
  {
    name: 'View Members',
    scope: PermissionScope.ORGANIZATION,
    resource: PermissionResource.MEMBERS,
    action: PermissionAction.READ,
  },
  {
    name: 'Manage Integrations',
    scope: PermissionScope.ORGANIZATION,
    resource: PermissionResource.INTEGRATION,
    action: PermissionAction.MANAGE,
  },

  // SOCIAL ACCOUNT
  {
    name: 'Create Posts',
    scope: PermissionScope.SOCIAL_ACCOUNT,
    resource: PermissionResource.POSTS,
    action: PermissionAction.CREATE,
  },
  {
    name: 'Publish Posts',
    scope: PermissionScope.SOCIAL_ACCOUNT,
    resource: PermissionResource.POSTS,
    action: PermissionAction.PUBLISH,
  },
  {
    name: 'Delete Posts',
    scope: PermissionScope.SOCIAL_ACCOUNT,
    resource: PermissionResource.POSTS,
    action: PermissionAction.DELETE,
  },
  {
    name: 'View Posts',
    scope: PermissionScope.SOCIAL_ACCOUNT,
    resource: PermissionResource.POSTS,
    action: PermissionAction.READ,
  },
  {
    name: 'Create Drafts',
    scope: PermissionScope.SOCIAL_ACCOUNT,
    resource: PermissionResource.DRAFT,
    action: PermissionAction.CREATE,
  },
  {
    name: 'Approve Drafts',
    scope: PermissionScope.SOCIAL_ACCOUNT,
    resource: PermissionResource.DRAFT,
    action: PermissionAction.APPROVE,
  },
  {
    name: 'View Analytics',
    scope: PermissionScope.SOCIAL_ACCOUNT,
    resource: PermissionResource.ANALYTICS,
    action: PermissionAction.READ,
  },
  {
    name: 'Manage Messages',
    scope: PermissionScope.SOCIAL_ACCOUNT,
    resource: PermissionResource.MESSAGE,
    action: PermissionAction.MANAGE,
  },
  {
    name: 'Manage Comments',
    scope: PermissionScope.SOCIAL_ACCOUNT,
    resource: PermissionResource.COMMENT,
    action: PermissionAction.MANAGE,
  },
];

export async function seedPermissions() {
  // Create missing permissions
  await prisma.permission.createMany({
    data: SYSTEM_PERMISSIONS,
    skipDuplicates: true,
  });

  // Fetch all permissions and create a map: "scope:resource:action" => permissionId
  const allPermissions = await prisma.permission.findMany();
  const permissionMap = new Map<string, string>();
  allPermissions.forEach(p => permissionMap.set(`${p.scope}:${p.resource}:${p.action}`, p.id));

  return permissionMap;
}
