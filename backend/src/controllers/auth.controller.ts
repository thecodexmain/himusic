import { Request, Response, NextFunction } from 'express';
import { body } from 'express-validator';
import nodemailer from 'nodemailer';
import { prisma } from '../utils/prisma';
import { authService } from '../services/auth.service';
import { CacheService } from '../services/cache.service';
import { ApiError } from '../utils/ApiError';
import { ApiResponse } from '../utils/ApiResponse';
import { AuthRequest } from '../middleware/auth';
import { config } from '../config';
import { logger } from '../utils/logger';

const cache = new CacheService();

export const registerValidation = [
  body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 100 }),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain uppercase, lowercase, and a number'),
];

export const loginValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password is required'),
];

export const register = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { name, email, password } = req.body as { name: string; email: string; password: string };

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new ApiError(409, 'Email already registered');

    const hashedPassword = await authService.hashPassword(password);

    const user = await prisma.user.create({
      data: { name, email, password: hashedPassword },
      select: { id: true, name: true, email: true, avatar: true, role: true, createdAt: true },
    });

    const { accessToken, refreshToken } = authService.generateTokenPair(
      user.id,
      user.email,
      user.role
    );
    await authService.storeRefreshToken(user.id, refreshToken);

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: config.isProd,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(201).json(
      ApiResponse.success('Registration successful', { user, accessToken })
    );
  } catch (err) {
    next(err);
  }
};

export const login = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, password } = req.body as { email: string; password: string };

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true, avatar: true, role: true, password: true },
    });

    if (!user || !user.password) {
      throw new ApiError(401, 'Invalid email or password');
    }

    const isValid = await authService.comparePassword(password, user.password);
    if (!isValid) throw new ApiError(401, 'Invalid email or password');

    const { accessToken, refreshToken } = authService.generateTokenPair(
      user.id,
      user.email,
      user.role
    );
    await authService.storeRefreshToken(user.id, refreshToken);

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: config.isProd,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    const { password: _, ...safeUser } = user;
    res.json(ApiResponse.success('Login successful', { user: safeUser, accessToken }));
  } catch (err) {
    next(err);
  }
};

export const logout = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const refreshToken =
      (req.cookies?.refreshToken as string | undefined) ??
      (req.body as { refreshToken?: string })?.refreshToken;

    if (refreshToken) {
      await authService.revokeRefreshToken(refreshToken);
    }

    res.clearCookie('refreshToken', { httpOnly: true, secure: config.isProd, sameSite: 'strict' });
    res.json(ApiResponse.success('Logged out successfully'));
  } catch (err) {
    next(err);
  }
};

export const refreshToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token =
      (req.cookies?.refreshToken as string | undefined) ??
      (req.body as { refreshToken?: string })?.refreshToken;

    if (!token) throw new ApiError(401, 'Refresh token required');

    const { userId } = await authService.validateRefreshToken(token);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true },
    });
    if (!user) throw new ApiError(401, 'User not found');

    await authService.revokeRefreshToken(token);

    const { accessToken, refreshToken: newRefreshToken } =
      authService.generateTokenPair(user.id, user.email, user.role);
    await authService.storeRefreshToken(user.id, newRefreshToken);

    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: config.isProd,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json(ApiResponse.success('Token refreshed', { accessToken }));
  } catch (err) {
    next(err);
  }
};

export const forgotPassword = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email } = req.body as { email: string };

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.json(ApiResponse.success('If this email exists, a reset link has been sent'));
      return;
    }

    const resetToken = authService.generatePasswordResetToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await cache.set(
      `pwd-reset:${resetToken}`,
      { userId: user.id },
      3600
    );

    const resetUrl = `${config.clientUrl}/reset-password?token=${resetToken}`;

    try {
      const transporter = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.port === 465,
        auth: { user: config.smtp.user, pass: config.smtp.pass },
      });

      await transporter.sendMail({
        from: config.smtp.from,
        to: email,
        subject: 'PrimeMusic - Password Reset',
        html: `
          <h2>Password Reset Request</h2>
          <p>Click the link below to reset your password. This link expires in 1 hour.</p>
          <a href="${resetUrl}" style="padding: 12px 24px; background: #1db954; color: white; text-decoration: none; border-radius: 4px;">Reset Password</a>
          <p>If you didn't request this, please ignore this email.</p>
        `,
      });
      logger.info(`Password reset email sent to: ${email}`);
    } catch (emailErr) {
      logger.error('Failed to send reset email:', emailErr);
    }

    void expiresAt;
    res.json(ApiResponse.success('If this email exists, a reset link has been sent'));
  } catch (err) {
    next(err);
  }
};

export const resetPassword = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { token, password } = req.body as { token: string; password: string };

    const stored = await cache.get<{ userId: string }>(`pwd-reset:${token}`);
    if (!stored) throw new ApiError(400, 'Invalid or expired reset token');

    const hashed = await authService.hashPassword(password);

    await prisma.user.update({
      where: { id: stored.userId },
      data: { password: hashed },
    });

    await Promise.all([
      cache.del(`pwd-reset:${token}`),
      authService.revokeAllUserTokens(stored.userId),
    ]);

    res.json(ApiResponse.success('Password reset successfully'));
  } catch (err) {
    next(err);
  }
};

export const googleAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { idToken } = req.body as { idToken: string };

    if (!idToken) throw new ApiError(400, 'Google ID token required');

    const verifyUrl = `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`;
    const response = await fetch(verifyUrl);
    if (!response.ok) throw new ApiError(401, 'Invalid Google token');

    const googleUser = await response.json() as {
      sub?: string;
      email?: string;
      name?: string;
      picture?: string;
      aud?: string;
    };

    if (!googleUser.sub || !googleUser.email) {
      throw new ApiError(401, 'Invalid Google token payload');
    }

    if (config.google.clientId && googleUser.aud !== config.google.clientId) {
      throw new ApiError(401, 'Google token audience mismatch');
    }

    let user = await prisma.user.findFirst({
      where: {
        OR: [{ googleId: googleUser.sub }, { email: googleUser.email }],
      },
      select: { id: true, name: true, email: true, avatar: true, role: true },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: googleUser.email,
          name: googleUser.name ?? googleUser.email,
          avatar: googleUser.picture,
          googleId: googleUser.sub,
        },
        select: { id: true, name: true, email: true, avatar: true, role: true },
      });
    } else if (!user) {
      await prisma.user.update({
        where: { id: user!.id },
        data: { googleId: googleUser.sub, avatar: googleUser.picture },
      });
    }

    const { accessToken, refreshToken } = authService.generateTokenPair(
      user.id,
      user.email,
      user.role
    );
    await authService.storeRefreshToken(user.id, refreshToken);

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: config.isProd,
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json(ApiResponse.success('Google authentication successful', { user, accessToken }));
  } catch (err) {
    next(err);
  }
};

export const getMe = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
        role: true,
        createdAt: true,
        _count: {
          select: {
            playlists: true,
            likedSongs: true,
            followers: true,
            following: true,
          },
        },
      },
    });

    if (!user) throw new ApiError(404, 'User not found');
    res.json(ApiResponse.success('User retrieved', user));
  } catch (err) {
    next(err);
  }
};
