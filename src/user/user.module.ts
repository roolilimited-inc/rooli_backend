import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { BillingModule } from '@/billing/billing.module';

@Module({
  imports: [BillingModule],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
