import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

export const prisma: PrismaClient =
  global.__prisma ??
  new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ],
  });

if (process.env['NODE_ENV'] !== 'production') {
  global.__prisma = prisma;
}

prisma.$on('error' as never, (e: { message: string }) => {
  logger.error('Prisma error:', e.message);
});

prisma.$on('warn' as never, (e: { message: string }) => {
  logger.warn('Prisma warn:', e.message);
});

export const connectDatabase = async (): Promise<void> => {
  await prisma.$connect();
  logger.info('Database connected');
};

export const disconnectDatabase = async (): Promise<void> => {
  await prisma.$disconnect();
  logger.info('Database disconnected');
};
