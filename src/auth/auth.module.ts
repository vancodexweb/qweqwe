import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TokenService } from './token.service';

/**
 * JwtModule подключен без глобальной конфигурации секрета/TTL: и access,
 * и refresh токены подписываются в TokenService с явным указанием
 * secret/expiresIn на каждый вызов (у них разные секреты и разное время жизни).
 *
 * JwtAuthGuard/JwtRefreshGuard намеренно не объявлены здесь как provider —
 * см. комментарий в src/common/guards/jwt-auth.guard.ts.
 */
@Module({
  imports: [PassportModule, JwtModule.register({}), UsersModule],
  controllers: [AuthController],
  providers: [AuthService, TokenService, JwtStrategy, JwtRefreshStrategy],
  exports: [TokenService],
})
export class AuthModule {}
