import { PrismaService } from '@/prisma/prisma.service';
import { RoleScope } from '@generated/enums';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import slugify from 'slugify';
import { AddWorkspaceMemberDto } from './dtos/add-member.dto';
import { CreateWorkspaceDto } from './dtos/create-workspace.dto';
import { UpdateWorkspaceDto } from './dtos/update-workspace.dto';

@Injectable()
export class WorkspaceService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, orgId: string, dto: CreateWorkspaceDto) {
    // A. Validate Limits & Fetch Features
    // We get the 'features' back here to avoid querying the DB twice
    const { features } = await this.checkWorkspaceLimitAndGetFeatures(orgId);

    // B. Generate Unique Slug (Scoped to Organization)
    const slug = await this.generateUniqueSlug(orgId, dto.name);

    // C. Prepare Data (Feature Gating)
    // Only save Client CRM fields if the plan allows 'clientLabels'
    const clientData = features['clientLabels']
      ? {
          clientName: dto.clientName,
          clientStatus: dto.clientStatus || 'Active',
          clientColor: dto.clientColor || '#3b82f6',
          clientContact: dto.clientContact,
        }
      : {};

    // D. Create Workspace
    const workspace = await this.prisma.workspace.create({
      data: {
        name: dto.name,
        slug: slug,
        organizationId: orgId,
        ...clientData, // Spread the conditional data
        members: {
          create: {
            userId,
            roleId: (await this.fetchDefaultWorkspaceRole()).id,
          },
        },
      },
    });

    return workspace;
  }

  async findAll(orgId: string, userId: string) {
    // 1. Check if user is Org Admin/Owner (The "Super View")
    // Optimization: Select only the role name to be faster
    const orgMember = await this.prisma.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId } },
      select: { role: { select: { name: true } } },
    });

    if (orgMember && ['OWNER', 'ADMIN'].includes(orgMember.role.name)) {
      return this.prisma.workspace.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { members: true, socialAccounts: true } },
        }, // Useful UI stats
      });
    }

    // 2. Otherwise, return only workspaces where they are a member
    return this.prisma.workspace.findMany({
      where: {
        organizationId: orgId,
        members: { some: { userId } },
      },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { members: true, socialAccounts: true } } },
    });
  }

  async findOne(id: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id },
      include: {
        _count: {
          select: { socialAccounts: true, posts: true, members: true },
        },
        // Include BrandKit so the frontend can load colors immediately
        brandKit: true,
      },
    });

    if (!workspace) throw new NotFoundException('Workspace not found');
    return workspace;
  }

  async update(workspaceId: string, dto: UpdateWorkspaceDto) {
    // Optional: Add logic to check 'clientLabels' feature here too
    // if you want to be strict about updates.

    return this.prisma.workspace.update({
      where: { id: workspaceId },
      data: {
        ...dto,
        // Slug updates are risky for SEO/Bookmarking.
        // If you allow it, you must re-run generateUniqueSlug logic.
      },
    });
  }

  async delete(workspaceId: string) {
    return this.prisma.workspace.delete({
      where: { id: workspaceId },
    });
  }

  // --------------------------------------------------------
  // 2. SWITCHING LOGIC
  // --------------------------------------------------------

  async switchWorkspace(userId: string, workspaceId: string) {
    // 1. Verify Access
    const hasAccess = await this.verifyAccess(userId, workspaceId);
    if (!hasAccess) {
      throw new ForbiddenException('You do not have access to this workspace');
    }

    // 2. Update User State ("Sticky Session")
    return this.prisma.user.update({
      where: { id: userId },
      data: { lastActiveWorkspaceId: workspaceId },
    });
  }

  async verifyAccess(userId: string, workspaceId: string): Promise<boolean> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { organizationId: true },
    });

    if (!workspace) throw new NotFoundException('Workspace not found');

    // Optimization: Run both checks in parallel using Promise.all is unsafe
    // because we need the Org ID first.
    // But we can check Org Membership efficiently.

    const orgMember = await this.prisma.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: workspace.organizationId,
          userId,
        },
      },
      select: { role: { select: { name: true } } },
    });

    if (orgMember && ['OWNER', 'ADMIN'].includes(orgMember.role.name)) {
      return true;
    }

    const wsMember = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });

    return !!wsMember;
  }

  // --------------------------------------------------------
  // 3. MEMBER MANAGEMENT (Agency Features)
  // --------------------------------------------------------

  async addMember(workspaceId: string, dto: AddWorkspaceMemberDto) {
    // 1. Find User by Email
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user) throw new NotFoundException('User not found');

    // 2. Check for Duplicates
    const exists = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: user.id } },
    });
    if (exists)
      throw new ConflictException('User is already a member of this workspace');

    // 3. Validate Role Scope 
    const role = await this.prisma.role.findUnique({
      where: { id: dto.roleId },
    });
    if (!role) throw new NotFoundException('Role not found');

    // Ensure we don't assign an "Organization" role (like Billing Admin) to a "Workspace"
    if (role.scope !== RoleScope.WORKSPACE) {
      throw new BadRequestException(
        'Invalid role: Must be a Workspace-level role',
      );
    }

    return this.prisma.workspaceMember.create({
      data: {
        workspaceId,
        userId: user.id,
        roleId: dto.roleId,
      },
    });
  }

  async removeMember(workspaceId: string, userIdToRemove: string) {
    return this.prisma.workspaceMember.delete({
      where: {
        workspaceId_userId: { workspaceId, userId: userIdToRemove },
      },
    });
  }

  async inviteMember(inviterId: string, workspaceId: string, email: string, roleId: string) {
  const lowerEmail = email.toLowerCase();

  // 1. Check Permissions (Done by Guards, but good to double check)
  // ...

  // 2. Check if user is ALREADY in the workspace
  // We don't want to spam people who are already on the team
  const existingMember = await this.prisma.workspaceMember.findFirst({
    where: { 
      workspaceId, 
      user: { email: lowerEmail } 
    }
  });

  if (existingMember) throw new ConflictException('User is already in this workspace');

  // 3. Generate Secret Token
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 Day Expiry

  // 4. Save Invitation to DB
  // We use upsert so if we invite them again, it just refreshes the token
  const invitation = await this.prisma.invitation.upsert({
    where: { email_workspaceId: { email: lowerEmail, workspaceId } },
    update: { token, expiresAt, roleId },
    create: {
      email: lowerEmail,
      workspaceId,
      organizationId: (await this.getOrgId(workspaceId)), // Helper to fetch Org ID
      roleId,
      inviterId,
      token,
      expiresAt
    }
  });

  // 5. SEND EMAIL (Crucial Step)
  // You would use a dedicated EmailService here (SendGrid, Resend, Postmark)
  const inviteLink = `${this.config.get('FRONTEND_URL')}/join?token=${token}`;
  
  await this.emailService.send({
    to: lowerEmail,
    subject: 'You have been invited to join a Workspace on Rooli',
    html: `
      <p>You have been invited to join the workspace.</p>
      <p>Click here to accept: <a href="${inviteLink}">${inviteLink}</a></p>
    `
  });

  return { message: 'Invitation sent' };
}

  // --------------------------------------------------------
  // 4. HELPERS
  // --------------------------------------------------------

  private async generateUniqueSlug(
    orgId: string,
    name: string,
  ): Promise<string> {
    const baseSlug = slugify(name, { lower: true, strict: true });
    let slug = baseSlug;
    let count = 1;

    while (true) {
      const existing = await this.prisma.workspace.findUnique({
        where: { organizationId_slug: { organizationId: orgId, slug } },
      });
      if (!existing) break;
      slug = `${baseSlug}-${count}`;
      count++;
    }
    return slug;
  }

  private async checkWorkspaceLimitAndGetFeatures(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        subscription: {
          include: { plan: true },
        },
        workspaces: { select: { id: true } },
      },
    });

    if (!org) throw new NotFoundException('Organization not found');

    // Handle "No Subscription" case (Fallback to Free/Default limits)
    const plan = org.subscription?.plan;
    const maxWorkspaces = plan?.maxWorkspaces || 1;
    const currentCount = org.workspaces.length;

    if (currentCount >= maxWorkspaces) {
      throw new ForbiddenException(
        `Workspace limit reached. Your plan allows ${maxWorkspaces} workspaces.`,
      );
    }

    return { features: (plan?.features as any) || {} };
  }

  private async fetchDefaultWorkspaceRole() {
    // You should seed a default 'Editor' or 'Manager' role with scope WORKSPACE
    return this.prisma.role.findFirstOrThrow({
      where: { scope: RoleScope.WORKSPACE, isDefault: true },
    });
  }
}
