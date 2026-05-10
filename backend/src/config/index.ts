import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const required = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
};

const optional = (key: string, fallback: string): string =>
  process.env[key] ?? fallback;

export const config = {
  env: optional('NODE_ENV', 'development'),
  port: parseInt(optional('PORT', '5000'), 10),
  clientUrl: optional('CLIENT_URL', 'http://localhost:3000'),

  database: {
    url: required('DATABASE_URL'),
  },

  redis: {
    url: optional('REDIS_URL', 'redis://localhost:6379'),
  },

  jwt: {
    accessSecret: optional('JWT_ACCESS_SECRET', 'default-access-secret-change-me'),
    refreshSecret: optional('JWT_REFRESH_SECRET', 'default-refresh-secret-change-me'),
    accessExpiresIn: optional('JWT_ACCESS_EXPIRES_IN', '15m'),
    refreshExpiresIn: optional('JWT_REFRESH_EXPIRES_IN', '7d'),
  },

  google: {
    clientId: optional('GOOGLE_CLIENT_ID', ''),
    clientSecret: optional('GOOGLE_CLIENT_SECRET', ''),
  },

  smtp: {
    host: optional('SMTP_HOST', 'smtp.gmail.com'),
    port: parseInt(optional('SMTP_PORT', '587'), 10),
    user: optional('SMTP_USER', ''),
    pass: optional('SMTP_PASS', ''),
    from: optional('EMAIL_FROM', 'PrimeMusic <noreply@primemusic.com>'),
  },

  rateLimit: {
    windowMs: parseInt(optional('RATE_LIMIT_WINDOW_MS', '900000'), 10),
    max: parseInt(optional('RATE_LIMIT_MAX', '100'), 10),
  },

  cache: {
    ttlSearch: parseInt(optional('CACHE_TTL_SEARCH', '300'), 10),
    ttlStream: parseInt(optional('CACHE_TTL_STREAM', '1800'), 10),
    ttlTrending: parseInt(optional('CACHE_TTL_TRENDING', '600'), 10),
    ttlRecommendations: parseInt(optional('CACHE_TTL_RECOMMENDATIONS', '3600'), 10),
  },

  isProd: optional('NODE_ENV', 'development') === 'production',
  isDev: optional('NODE_ENV', 'development') === 'development',
} as const;
