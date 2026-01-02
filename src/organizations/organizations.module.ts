import { Module } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { MembersController } from './members/members.controller';
import { InvitationsController } from './invitations/invitations.controller';
import { InvitationsService } from './invitations/invitations.service';
import { MembersService } from './members/members.service';
//import { AccessControlModule } from '@/access-control/access-control.module';
import { BillingModule } from '@/billing/billing.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';

@Module({
  imports: [
    BillingModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get('JWT_EXPIRES_IN'),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [
    OrganizationsController,
    MembersController,
    InvitationsController,
  ],
  providers: [OrganizationsService, MembersService, InvitationsService, JwtService],
})
export class OrganizationsModule {}
