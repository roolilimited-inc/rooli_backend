export function isSuperAdminOrOwner(user: any, role: any): boolean {
  // Check Global Super Admin
  if (user?.systemRole?.name === 'super_admin') return true;

  // Check Context Owner (e.g. Org Owner)
  if (role?.name === 'owner' && role?.isSystem) return true;

  return false;
}