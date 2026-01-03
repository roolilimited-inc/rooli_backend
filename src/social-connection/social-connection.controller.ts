import { Controller } from '@nestjs/common';
import { SocialConnectionService } from './social-connection.service';

@Controller('social-connection')
export class SocialConnectionController {
  constructor(private readonly socialConnectionService: SocialConnectionService) {}
}
