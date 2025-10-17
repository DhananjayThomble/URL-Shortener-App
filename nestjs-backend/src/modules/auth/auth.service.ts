import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';

import { UsersService } from '../users/users.service';
import { RefreshTokenService } from '../users/entities/refresh-token.service';
import { User } from '../users/entities/user.entity';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { CacheService } from '../../common/services/cache.service';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private refreshTokenService: RefreshTokenService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private cacheService: CacheService,
  ) {}

  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await this.usersService.findByEmail(email);
    if (user && await this.comparePassword(password, user.passwordHash)) {
      return user;
    }
    return null;
  }

  async login(loginDto: LoginDto) {
    const user = await this.validateUser(loginDto.email, loginDto.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = { 
      sub: user.id, 
      email: user.email, 
      role: user.role 
    };

    const accessToken = this.jwtService.sign(payload);
    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN', '7d'),
    });

    // Store refresh token in database
    await this.refreshTokenService.createRefreshToken(user.id, refreshToken);

    // Cache user session data for quick access
    const sessionData = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      lastLogin: new Date(),
    };
    
    await this.cacheService.cacheUserSession(user.id, sessionData, 900); // 15 minutes TTL

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: sessionData,
    };
  }

  async register(registerDto: RegisterDto) {
    const existingUser = await this.usersService.findByEmail(registerDto.email);
    if (existingUser) {
      throw new UnauthorizedException('User already exists');
    }

    const hashedPassword = await this.hashPassword(registerDto.password);
    const user = await this.usersService.create({
      ...registerDto,
      passwordHash: hashedPassword,
    });

    return this.login({ email: user.email, password: registerDto.password });
  }

  async refreshToken(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
      });

      const user = await this.usersService.findById(payload.sub);
      if (!user) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      // Validate refresh token in database
      const isValidToken = await this.refreshTokenService.validateRefreshToken(
        user.id,
        refreshToken,
      );

      if (!isValidToken) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const newPayload = { 
        sub: user.id, 
        email: user.email, 
        role: user.role 
      };

      return {
        access_token: this.jwtService.sign(newPayload),
      };
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    await this.refreshTokenService.revokeRefreshToken(userId, refreshToken);
    
    // Clear user session from cache
    await this.cacheService.invalidateUserSession(userId);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.refreshTokenService.revokeAllUserTokens(userId);
    
    // Clear all user-related cache data
    await this.cacheService.invalidateUserCache(userId);
  }

  async hashPassword(password: string): Promise<string> {
    const saltRounds = this.configService.get('BCRYPT_SALT_ROUNDS', 12);
    return bcrypt.hash(password, saltRounds);
  }

  async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  async validateJWTPayload(payload: any): Promise<User> {
    // Try to get user from cache first
    const cachedUser = await this.cacheService.getCachedUserSession(payload.sub);
    if (cachedUser) {
      // Return a User-like object from cached data
      return {
        id: cachedUser.id,
        email: cachedUser.email,
        name: cachedUser.name,
        role: cachedUser.role,
      } as User;
    }

    // Fallback to database
    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException('Invalid token');
    }

    // Cache the user data for future requests
    const sessionData = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      lastAccess: new Date(),
    };
    
    await this.cacheService.cacheUserSession(user.id, sessionData, 900); // 15 minutes TTL

    return user;
  }
}