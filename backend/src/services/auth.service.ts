import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { prisma } from '../utils/prisma';
import { ApiError } from '../utils/ApiError';
import { JwtPayload, TokenPair } from '../types';
import { CacheService } from './cache.service';
import { logger } from '../utils/logger';

const cache = new CacheService();
const BCRYPT_ROUNDS = 12;
const REFRESH_TOKEN_CACHE_PREFIX = 'rt:';

export class AuthService {
  generateTokenPair(userId: string, email: string, role: string): TokenPair {
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: userId,
      email,
      role,
    };

    const accessToken = jwt.sign(payload, config.jwt.accessSecret, {
      expiresIn: config.jwt.accessExpiresIn,
    } as jwt.SignOptions);

    const refreshToken = jwt.sign(
      { sub: userId, jti: uuidv4() },
      config.jwt.refreshSecret,
      { expiresIn: config.jwt.refreshExpiresIn } as jwt.SignOptions
    );

    return { accessToken, refreshToken };
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }

  async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  async storeRefreshToken(
    userId: string,
    token: string,
    expiresInSeconds = 7 * 24 * 60 * 60
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    await prisma.refreshToken.create({
      data: { token, userId, expiresAt },
    });

    await cache.set(
      `${REFRESH_TOKEN_CACHE_PREFIX}${token}`,
      { userId },
      expiresInSeconds
    );
  }

  async validateRefreshToken(token: string): Promise<{ userId: string }> {
    let payload: { sub: string };
    try {
      payload = jwt.verify(token, config.jwt.refreshSecret) as { sub: string };
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new ApiError(401, 'Refresh token expired');
      }
      throw new ApiError(401, 'Invalid refresh token');
    }

    const cached = await cache.get<{ userId: string }>(
      `${REFRESH_TOKEN_CACHE_PREFIX}${token}`
    );

    if (cached) return cached;

    const stored = await prisma.refreshToken.findFirst({
      where: {
        token,
        userId: payload.sub,
        expiresAt: { gt: new Date() },
      },
    });

    if (!stored) {
      throw new ApiError(401, 'Refresh token not found or expired');
    }

    return { userId: payload.sub };
  }

  async revokeRefreshToken(token: string): Promise<void> {
    await Promise.allSettled([
      prisma.refreshToken.deleteMany({ where: { token } }),
      cache.del(`${REFRESH_TOKEN_CACHE_PREFIX}${token}`),
    ]);
  }

  async revokeAllUserTokens(userId: string): Promise<void> {
    const tokens = await prisma.refreshToken.findMany({
      where: { userId },
      select: { token: true },
    });

    await prisma.refreshToken.deleteMany({ where: { userId } });

    await Promise.allSettled(
      tokens.map((t) => cache.del(`${REFRESH_TOKEN_CACHE_PREFIX}${t.token}`))
    );
    logger.info(`Revoked all tokens for user: ${userId}`);
  }

  async cleanupExpiredTokens(): Promise<void> {
    await prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  }

  generatePasswordResetToken(): string {
    return uuidv4();
  }
}

export const authService = new AuthService();
