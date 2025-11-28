import {
  PrismaClient,
  PermissionAction,
  PermissionResource,
  PermissionScope,
  RoleScope,
  Prisma,
} from '../generated/prisma/client';
import slugify from 'slugify';

const prisma = new PrismaClient({} as any);

/**
 * Types used by the seed data
 */
type PermSpec = {
  name: string;
  scope: PermissionScope;
  resource: PermissionResource;
  action: PermissionAction;
  description?: string | null;
};

type RoleSeed = {
  name: string;
  displayName: string;
  description?: string | null;
  scope: RoleScope;
  isSystem?: boolean;
  isDefault?: boolean;
  permissions: string[]; // "SCOPE:RESOURCE:ACTION"
};

/**
 * System seed data (you can edit / extend these)
 */
const SYSTEM_PERMISSIONS: PermSpec[] = [
  // organization
  { name: 'Organization Management', scope: PermissionScope.ORGANIZATION, resource: PermissionResource.ORGANIZATION, action: PermissionAction.MANAGE },
  { name: 'Member Management', scope: PermissionScope.ORGANIZATION, resource: PermissionResource.MEMBERS, action: PermissionAction.MANAGE },
  { name: 'View Members', scope: PermissionScope.ORGANIZATION, resource: PermissionResource.MEMBERS, action: PermissionAction.READ },
  { name: 'Billing Management', scope: PermissionScope.ORGANIZATION, resource: PermissionResource.BILLING, action: PermissionAction.MANAGE },
  { name: 'Settings Management', scope: PermissionScope.ORGANIZATION, resource: PermissionResource.SETTINGS, action: PermissionAction.MANAGE },

  // social account
  { name: 'Post Creation', scope: PermissionScope.SOCIAL_ACCOUNT, resource: PermissionResource.POSTS, action: PermissionAction.CREATE },
  { name: 'Post Scheduling', scope: PermissionScope.SOCIAL_ACCOUNT, resource: PermissionResource.SCHEDULING, action: PermissionAction.MANAGE },
  { name: 'View Analytics', scope: PermissionScope.SOCIAL_ACCOUNT, resource: PermissionResource.ANALYTICS, action: PermissionAction.READ },
  { name: 'Manage Messages', scope: PermissionScope.SOCIAL_ACCOUNT, resource: PermissionResource.MESSAGE, action: PermissionAction.MANAGE },
  { name: 'Manage Comments', scope: PermissionScope.SOCIAL_ACCOUNT, resource: PermissionResource.COMMENT, action: PermissionAction.MANAGE },
  { name: 'Content Management', scope: PermissionScope.SOCIAL_ACCOUNT, resource: PermissionResource.CONTENT, action: PermissionAction.MANAGE },
];

const SYSTEM_ROLES: RoleSeed[] = [
  // organization roles (system/global have organizationId = null)
  {
    name: 'owner',
    displayName: 'Owner',
    description: 'Full organization ownership with all permissions',
    scope: RoleScope.ORGANIZATION,
    isSystem: true,
    permissions: ['ORGANIZATION:ORGANIZATION:MANAGE'],
  },
  {
    name: 'admin',
    displayName: 'Admin',
    description: 'Organization administrator with management permissions',
    scope: RoleScope.ORGANIZATION,
    isSystem: true,
    permissions: ['ORGANIZATION:MEMBERS:MANAGE', 'ORGANIZATION:SETTINGS:MANAGE'],
  },
  {
    name: 'member',
    displayName: 'Member',
    description: 'Standard organization member',
    scope: RoleScope.ORGANIZATION,
    isSystem: true,
    isDefault: true,
    permissions: ['ORGANIZATION:MEMBERS:READ'],
  },

  // social account roles
  {
    name: 'manager',
    displayName: 'Social Manager',
    description: 'Full social account management',
    scope: RoleScope.SOCIAL_ACCOUNT,
    isSystem: true,
    permissions: ['SOCIAL_ACCOUNT:POSTS:CREATE', 'SOCIAL_ACCOUNT:SCHEDULING:MANAGE'],
  },
  {
    name: 'contributor',
    displayName: 'Contributor',
    description: 'Can create and schedule content',
    scope: RoleScope.SOCIAL_ACCOUNT,
    isSystem: true,
    isDefault: true,
    permissions: ['SOCIAL_ACCOUNT:POSTS:CREATE', 'SOCIAL_ACCOUNT:SCHEDULING:MANAGE'],
  },
];

/**
 * Helper to detect optional column presence (uses table name lowercase).
 */
async function hasColumn(model: string, column: string): Promise<boolean> {
  try {
    // Postgres-compatible check. Adjust if you use a different DB.
    const rows: any = await prisma.$queryRawUnsafe(
      `SELECT column_name FROM information_schema.columns WHERE table_name='${model.toLowerCase()}' AND column_name='${column}' LIMIT 1`
    );
    return Array.isArray(rows) && rows.length > 0;
  } catch (err) {
    // don’t fail the whole seed if the introspection fails
    console.warn('hasColumn check failed, assuming column does not exist', { model, column, err });
    return false;
  }
}

/**
 * Seed permissions in bulk (idempotent)
 * Uses createMany(...) + skipDuplicates so running multiple times is safe.
 */
async function seedPermissions() {
  const createManyData = SYSTEM_PERMISSIONS.map((p) => ({
    name: p.name,
    description: p.description ?? null,
    scope: p.scope,
    resource: p.resource,
    action: p.action,
  }));

  // Bulk create (skip duplicates). Good performance for many rows.
  await prisma.permission.createMany({
    data: createManyData,
    skipDuplicates: true,
  });

  // Return all system permissions we care about, keyed for quick lookup.
  const keys = SYSTEM_PERMISSIONS.map((p) => ({
    scope: p.scope,
    resource: p.resource,
    action: p.action,
  }));

  // fetch them
  const fetched = await prisma.permission.findMany({
    where: {
      OR: keys.map((k) => ({
        scope: k.scope,
        resource: k.resource,
        action: k.action,
      })),
    },
  });

  // map by a composite key "SCOPE:RESOURCE:ACTION" => id
  const map = new Map<string, string>();
  for (const perm of fetched) {
    const key = `${perm.scope}:${perm.resource}:${perm.action}`;
    map.set(key, perm.id);
  }
  return map;
}

/**
 * Ensure a single role exists and is in the desired shape (idempotent).
 * For "system" roles we use organizationId = null.
 */
async function ensureRole(roleSeed: RoleSeed, permMap: Map<string, string>, hasSlug: boolean) {
  // Try to find existing system/global role (organizationId = null)
  const existing = await prisma.role.findFirst({
    where: {
      name: roleSeed.name,
      scope: roleSeed.scope,
      organizationId: null,
    },
  });

  if (existing) {
    // Update metadata if changed
    await prisma.role.update({
      where: { id: existing.id },
      data: {
        displayName: roleSeed.displayName,
        description: roleSeed.description ?? existing.description,
        isSystem: !!roleSeed.isSystem,
        isDefault: !!roleSeed.isDefault,
      },
    });

    // Attach permissions (bulk createMany on RolePermission with skipDuplicates)
    const rpData = roleSeed.permissions
      .map((p) => {
        const pid = permMap.get(p);
        if (!pid) return null;
        return { roleId: existing.id, permissionId: pid };
      })
      .filter(Boolean) as { roleId: string; permissionId: string }[];

    if (rpData.length > 0) {
      await prisma.rolePermission.createMany({
        data: rpData,
        skipDuplicates: true,
      });
    }

    return existing;
  }

  // Create new role (system / global => organizationId = null)
  const createData: Prisma.RoleUncheckedCreateInput = {
    name: roleSeed.name,
    displayName: roleSeed.displayName,
    description: roleSeed.description ?? null,
    scope: roleSeed.scope,
    organizationId: null,
    isSystem: !!roleSeed.isSystem,
    isDefault: !!roleSeed.isDefault,
    // slug is optional; only include if column present
    ...(hasSlug ? { slug: slugify(roleSeed.name, { lower: true, strict: true }) } : {}),
  };

  // Use unchecked create input to avoid relation/nested typing issues for seeding
  const created = await prisma.role.create({ data: createData });

  // Attach permissions
  const rpData = roleSeed.permissions
    .map((p) => {
      const pid = permMap.get(p);
      if (!pid) return null;
      return { roleId: created.id, permissionId: pid };
    })
    .filter(Boolean) as { roleId: string; permissionId: string }[];

  if (rpData.length > 0) {
    await prisma.rolePermission.createMany({
      data: rpData,
      skipDuplicates: true,
    });
  }

  return created;
}

/**
 * Main seeding flow
 */
async function main() {
  console.log('Starting seed...');

  // detect optional slug column on Role model
  const hasSlug = await hasColumn('role', 'slug');

  // Seed permissions in bulk, and produce a composite key => id map
  console.log('Seeding permissions (createMany skipDuplicates)...');
  const permMap = await seedPermissions();
  console.log(`Seeded/loaded ${permMap.size} permissions.`);

  // Seed roles one-by-one
  console.log('Seeding roles...');
  for (const r of SYSTEM_ROLES) {
    console.log('Ensuring role:', r.name);
    await ensureRole(r, permMap, hasSlug);
  }

  console.log('Done seeding roles & permissions');
}

/**
 * Run & cleanup
 */
main()
  .then(async () => {
    console.log('Seeding finished');
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error('Seeder failed', err);
    await prisma.$disconnect();
    process.exit(1);
  });
