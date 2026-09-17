import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from '../common/decorators/auth.decorators';
import type { AuthenticatedRequest } from '../common/principal';
import { unauthenticated } from '../common/errors';

const clientContext = (req: AuthenticatedRequest) => ({
  ipAddress: req.ip ?? req.socket?.remoteAddress,
  userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
});

/**
 * Customer and staff sign-in are separate endpoints on purpose (blueprint §22).
 * They are never one endpoint with a `realm` parameter, because that makes
 * privilege escalation a matter of changing one field in a request body.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Post('customer/login')
  @HttpCode(200)
  async customerLogin(@Body() dto: LoginDto, @Req() req: AuthenticatedRequest) {
    return this.auth.loginCustomer(dto.email, dto.password, clientContext(req));
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Post('admin/login')
  @HttpCode(200)
  async adminLogin(@Body() dto: LoginDto, @Req() req: AuthenticatedRequest) {
    return this.auth.loginAdmin(dto.email, dto.password, clientContext(req));
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 900_000 } })
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body('refreshToken') refreshToken: string, @Req() req: AuthenticatedRequest) {
    if (!refreshToken) throw unauthenticated();
    return this.auth.refresh(refreshToken, clientContext(req));
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Body('refreshToken') refreshToken?: string): Promise<void> {
    await this.auth.logout(refreshToken);
  }
}
