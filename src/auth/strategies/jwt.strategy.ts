import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { PlanFeatures } from '@/billing/types/billing.types';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub, deletedAt: null },
      select: {
        id: true,
        email: true,
        lockedUntil: true,
        lastPasswordChange: true,
        refreshTokenVersion: true,
        organizationMemberships: {
          where: { organizationId: payload.orgId },
          include: {
            organization: {
              include: {
                subscription: {
                  include: { plan: true },
                },
              },
            },
            role: { select: { name: true } },
          },
        },
      },
    });
    if (!user) {
      throw new UnauthorizedException();
    }

    // Check if account is locked
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException('Account is locked');
    }

    // Check token version (Instant Revocation)
    if (payload.ver !== user.refreshTokenVersion) {
      throw new UnauthorizedException('Session has been revoked');
    }

    if (user.lastPasswordChange) {
      const passwordChangedTime = user.lastPasswordChange.getTime() / 1000;
      // If token was issued BEFORE the last password change, reject it
      if (payload.iat < passwordChangedTime) {
        throw new UnauthorizedException('Password changed, please login again');
      }
    }

    const membership = user.organizationMemberships[0];
    const org = membership?.organization;
    const plan = org?.subscription?.plan;

    return {
      userId: user.id,
      email: user.email,
      organizationId: payload.orgId,
      features: (plan?.features as unknown as PlanFeatures) || {},
      limits: {
         maxWorkspaces: plan?.maxWorkspaces || 1,
         maxTeamMembers: plan?.maxTeamMembers || 1,
      }
    };
  }
}
