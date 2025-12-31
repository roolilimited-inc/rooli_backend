import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ChangePasswordDto } from './dtos/change-password.dto';
import { UpdateProfileDto } from './dtos/update-profile.dto';
import { UserFiltersDto } from './dtos/user-filters.dto';
import * as argon2 from 'argon2';
import { SafeUser } from '@/auth/dtos/AuthResponse.dto';
import { PrismaService } from '@/prisma/prisma.service';
import { Prisma, SubscriptionGateway, UserType } from '@generated/client';
import slugify from 'slugify';
import { OnboardingDto } from './dtos/user-onboarding.dto';
import { BillingService } from '@/billing/billing.service';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly billingService: BillingService,
  ) {}

  async findById(id: string): Promise<SafeUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { id, deletedAt: null },
      include: {
        organizationMemberships: {
          include: {
            organization: {
              include: { subscription: { include: { plan: true } } },
            },
          },
        },
      },
    });

    if (!user) return null;

    const safeUser = this.toSafeUser(user);

    return safeUser;
  }

  async getUsersByOrganization(
    organizationId: string,
    filters: UserFiltersDto,
  ) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.OrganizationMemberWhereInput = {
      organizationId,
      isActive: true,
      user: { deletedAt: null },
    };

    if (filters.search) {
      where.user = {
        is: {
          deletedAt: null,
          OR: [
            { firstName: { contains: filters.search, mode: 'insensitive' } },
            { lastName: { contains: filters.search, mode: 'insensitive' } },
            { email: { contains: filters.search, mode: 'insensitive' } },
          ],
        },
      };
    }

    if (filters.role) {
      where.roleId = filters.role;
    }

    const [members, total] = await Promise.all([
      this.prisma.organizationMember.findMany({
        where,
        take: limit,
        skip,
        include: {
          user: true,
          role: true,
        },
        orderBy: { joinedAt: 'desc' },
      }),
      this.prisma.organizationMember.count({ where }),
    ]);

    return {
      data: members.map((member) => ({
        ...this.toSafeUser(member.user),
        orgRole: member.role,
        joinedAt: member.joinedAt,
        memberId: member.id,
      })),
      meta: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async updateProfile(
    userId: string,
    updateData: UpdateProfileDto,
  ): Promise<SafeUser> {
    const user = await this.prisma.user.update({
      where: { id: userId, deletedAt: null },
      data: {
        firstName: updateData.firstName?.trim(),
        lastName: updateData.lastName?.trim(),
        avatar: updateData.avatar,
      },
    });

    return this.toSafeUser(user);
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('User not found');

    const isCurrentValid = await argon2.verify(
      user.password,
      dto.currentPassword,
    );
    if (!isCurrentValid)
      throw new UnauthorizedException('Current password is incorrect');

    this.validatePasswordStrength(dto.newPassword);
    const hashedPassword = await argon2.hash(dto.newPassword);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        lastPasswordChange: new Date(),
        refreshToken: null, // Revoke sessions
        refreshTokenVersion: { increment: 1 },
      },
    });

    this.logger.log('Password changed successfully', { userId });
  }

  async deactivateMyAccount(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        deletedAt: new Date(),
        refreshToken: null,
        refreshTokenVersion: { increment: 1 },
        lastActiveAt: new Date(),
      },
    });
    this.logger.log(`User account deactivated`, { userId });
  }

  async userOnboarding(userId: string, dto: OnboardingDto) {
    const ownerRole = await this.fetchSystemRole('owner');

    let user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) throw new NotFoundException('User not found');

    // If DTO has a type, update it. Otherwise keep existing.
    if (dto.userType && dto.userType !== user.userType) {
      user = await this.prisma.user.update({
        where: { id: userId },
        data: { userType: dto.userType },
      });
    }

    // 3. Workspace Name Logic
    // Default: Match Organization Name (e.g. "Jane's Bakery")
    let workspaceName = dto.name;

    // Agency Logic: Use specific client name if provided
    if (user.userType === UserType.AGENCY) {
      workspaceName = dto.initialWorkspaceName || `${dto.name} Client 1`;
    }

    // 4. Slug Logic
    let slug = dto.slug || slugify(dto.name, { lower: true, strict: true });

    // Check Uniqueness
    const existing = await this.prisma.organization.findUnique({
      where: { slug },
    });
    if (existing) {
      throw new ConflictException('Organization URL (slug) is already taken.');
    }

    // 5. Gateway Logic
    const billingCountry = dto.billingCountry || 'NG';
    const isGlobal = billingCountry !== 'NG';
    const currency = isGlobal ? 'USD' : 'NGN';
    const subscriptionGateway = isGlobal
      ? SubscriptionGateway.STRIPE
      : SubscriptionGateway.PAYSTACK;

    let organization;

    try {
      organization = await this.prisma.$transaction(async (tx) => {
        // A. Create Organization (Billing Entity)
        const org = await tx.organization.create({
          data: {
            name: dto.name,
            slug,
            timezone: dto.timezone ?? 'UTC',
            email: dto.email ?? user.email,
            status: 'PENDING_PAYMENT',
            isActive: true,
            billingCountry,
            currency,
            subscriptionGateway,
            members: {
              create: {
                userId,
                roleId: ownerRole.id,
                permissions: {}, // Owners get all permissions via Role
              },
            },
          },
        });

        // B. Create Default Workspace (Social Context)
        const workspace = await tx.workspace.create({
          data: {
            name: workspaceName,
            organizationId: org.id,
            slug: slugify(workspaceName, { lower: true }),
          },
        });

        // C. Create Brand Kit (Linked to Workspace)
        await tx.brandKit.create({
          data: {
            workspaceId: workspace.id,
            name: `${workspaceName} Brand Kit`,
          },
        });

        return org;
      });

      // 6. Initialize Payment
      const paymentData = await this.billingService.initializePayment(
        organization.id,
        dto.planId,
        user,
      );

      return {
        organization,
        payment: paymentData,
      };
    } catch (err) {
      this.logger.error('Failed to create organization', err);

      if (organization?.id) {
        await this.prisma.organization
          .delete({ where: { id: organization.id } })
          .catch(() => {});
      }
      throw err;
    }
  }

  private validatePasswordStrength(password: string): void {
    if (password.length < 8)
      throw new BadRequestException('Password too short');

    // Quick Regex check for complexity
    const hasStrongChars = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d|.*[!@#$%^&*]).{8,}$/;
    if (!hasStrongChars.test(password)) {
      throw new BadRequestException(
        'Password needs uppercase, lowercase, and a number or symbol',
      );
    }
  }

  private async fetchSystemRole(roleName: string) {
    const role = await this.prisma.role.findFirst({
      where: { name: roleName }, // Assuming scope: 'SYSTEM' or 'ORGANIZATION'
    });

    if (!role)
      throw new InternalServerErrorException(
        `System Role '${roleName}' not found`,
      );

    return role;
  }

  private toSafeUser(user: any): SafeUser {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      avatar: user.avatar,
      userType: user.userType,
      isEmailVerified: user.isEmailVerified,
      lastActiveAt: user.lastActiveAt,
    };
  }
}
