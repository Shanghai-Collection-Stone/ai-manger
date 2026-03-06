import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AdminService } from '../services/admin.service.js';
import type { AdminRequest } from '../types/admin-request.types.js';

/**
 * @description 后台鉴权守卫
 * @keyword-en admin auth guard
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly adminService: AdminService) {}

  /**
   * @description 校验Authorization Bearer Token
   * @keyword-en verify bearer token
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AdminRequest>();
    const auth = req.headers.authorization;
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('UNAUTHORIZED');
    }
    const token = auth.slice(7).trim();
    if (!token) throw new UnauthorizedException('UNAUTHORIZED');
    const user = await this.adminService.getUserByToken(token);
    if (!user) throw new UnauthorizedException('UNAUTHORIZED');
    req.adminUser = user;
    req.adminToken = token;
    return true;
  }
}
