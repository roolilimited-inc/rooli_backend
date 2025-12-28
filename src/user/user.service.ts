import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import { Prisma } from '@generated/client';
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
    });
    return user ? this.toSafeUser(user) : null;
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
      user: {
        deletedAt: null,
      },
    };

    if (filters.search) {
      // build the inner UserWhereInput
      const userWhere: Prisma.UserWhereInput = {
        deletedAt: null,
        OR: [
          { firstName: { contains: filters.search, mode: 'insensitive' } },
          { lastName: { contains: filters.search, mode: 'insensitive' } },
          { email: { contains: filters.search, mode: 'insensitive' } },
        ],
      };

      where.user = { is: userWhere };
    }

    // 3. Filter by Organization Role (Not System Role)
    if (filters.role) {
      where.roleId = filters.role;
    }

    // 4. Execute Query
    const [members, total] = await Promise.all([
      this.prisma.organizationMember.findMany({
        where,
        take: limit,
        skip,
        include: {
          user: {
            select: this.getSafeUserSelect(),
          },
          role: true, // Include the Role details (e.g. "Manager")
        },
        orderBy: { joinedAt: 'desc' }, // Sort by when they joined the org
      }),
      this.prisma.organizationMember.count({ where }),
    ]);

    // 5. Transform Output
    const safeMembers = members.map((member) => ({
      userId: member.user.id,
      ...member.user,
      orgRole: member.role,
      joinedAt: member.joinedAt,
      memberId: member.id,
    }));

    return {
      data: safeMembers,
      meta: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      },
    };
  }

  // ------------------ Update ------------------
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
        updatedAt: new Date(),
      },
    });

    return this.toSafeUser(user);
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
    });

    if (!user) {
      this.logger.error('User not found for password change', { userId });
      throw new NotFoundException('User not found');
    }

    const isCurrentValid = await argon2.verify(
      user.password,
      dto.currentPassword,
    );

    if (!isCurrentValid) {
      this.logger.warn('Invalid current password attempt', { userId });
      throw new UnauthorizedException('Current password is incorrect');
    }

    this.validatePasswordStrength(dto.newPassword);
    const hashedPassword = await argon2.hash(dto.newPassword);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          password: hashedPassword,
          lastPasswordChange: new Date(),
          refreshToken: null,
          refreshTokenVersion: { increment: 1 },
        },
      });
    });

    this.logger.log('Password changed successfully', { userId });
  }

  private getSafeUserSelect() {
    return {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      avatar: true,
      role: true,
      isEmailVerified: true,
      lastActiveAt: true,
      createdAt: true,
    };
  }

  private toSafeUser(user: any): SafeUser {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      avatar: user.avatar,
      role: user.role,
      isEmailVerified: user.isEmailVerified,
      lastActiveAt: user.lastActiveAt,
    };
  }

  async getUserSocialAccounts(userId: string) {
    const memberships = await this.prisma.socialAccountMember.findMany({
      where: {
        userId,
      },
      include: {
        socialAccount: true,
      },
    });

    return memberships.map((m) => ({
      id: m.socialAccount.id,
      platform: m.socialAccount.platform,
      accountName: m.socialAccount.name,
      isActive: m.socialAccount.isActive,
      connectedAt: m.createdAt,
    }));
  }

  async deactivateMyAccount(userId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        deletedAt: new Date(),
        refreshToken: null, // Revoke refresh token
        refreshTokenVersion: { increment: 1 },
        lastActiveAt: new Date(),
      },
    });

    this.logger.log(`User account deactivated`, { userId });
  }

  validatePasswordStrength(password: string): void {
    if (password.length < 8) {
      throw new BadRequestException(
        'Password must be at least 8 characters long',
      );
    }

    const strengthChecks = {
      hasLowercase: /[a-z]/.test(password),
      hasUppercase: /[A-Z]/.test(password),
      hasNumbers: /\d/.test(password),
      hasSpecialChar: /[!@#$%^&*(),.?":{}|<>]/.test(password),
    };

    const strengthScore = Object.values(strengthChecks).filter(Boolean).length;

    if (strengthScore < 3) {
      throw new BadRequestException(
        'Password must contain at least 3 of the following: lowercase, uppercase, numbers, special characters',
      );
    }
  }

  async userOnboarding(userId: string, dto: OnboardingDto) {
    // 1. Update User Type (Onboarding)
    if (dto.userType) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { userType: dto.userType },
      });
    }

    // 2. Fetch User & Check Limits
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        organizationMemberships: {
          where: { role: { name: 'owner' } },
        },
      },
    });

    if (!user) throw new NotFoundException('User not found');

    const ownedOrgCount = user.organizationMemberships.length;
    if (user.userType === 'INDIVIDUAL' && ownedOrgCount >= 1) {
      throw new ForbiddenException({
        message:
          'Individual accounts are limited to 1 Workspace. Please upgrade to Agency.',
      });
    }

    // 3. Prepare Slug (Respect DTO, Fallback to Name)
    let slug = dto.slug;
    if (!slug) {
      slug = slugify(dto.name, { lower: true, strict: true });
    }

    // 4. Check Uniqueness
    const existing = await this.prisma.organization.findUnique({
      where: { slug },
    });
    if (existing) {
      throw new ConflictException('Organization URL (slug) is already taken.');
    }

    let organization; // Declare outside to access in catch block

    try {
      // 5. Transaction: Create DB Record
      organization = await this.prisma.$transaction(async (tx) => {
        const org = await tx.organization.create({
          data: {
            name: dto.name,
            slug,
            timezone: dto.timezone ?? 'UTC',
            email: dto.email ?? user.email,
            status: 'PENDING_PAYMENT',
            isActive: true,
          },
        });

        const ownerRole = await tx.role.findFirst({ where: { name: 'owner' } });
        if (!ownerRole)
          throw new InternalServerErrorException("Role 'owner' missing");

        await tx.organizationMember.create({
          data: {
            organizationId: org.id,
            userId,
            roleId: ownerRole.id,
            invitedBy: userId,
          },
        });

        await tx.brandKit.create({
          data: { organizationId: org.id, name: `${dto.name} Brand Kit` },
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
      console.log(err);
      // COMPENSATING TRANSACTION:
      // If payment failed (or any other error after DB creation),
      // we should delete the 'Zombie' org so the user can retry with the same slug.
      if (organization?.id) {
        await this.prisma.organization
          .delete({ where: { id: organization.id } })
          .catch(() => {});
      }

      this.logger.error('Failed to create organization', err);
      throw err;
    }
  }
}
