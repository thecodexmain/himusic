import { createClient, RedisClientType } from 'redis';
import { config } from './index';
import { logger } from '../utils/logger';

let redisClient: RedisClientType;

export const getRedisClient = (): RedisClientType => {
  if (!redisClient) {
    throw new Error('Redis client not initialized. Call connectRedis() first.');
  }
  return redisClient;
};

export const connectRedis = async (): Promise<void> => {
  redisClient = createClient({
    url: config.redis.url,
    socket: {
      reconnectStrategy: (retries: number) => {
        if (retries > 10) {
          logger.error('Redis: Too many reconnect attempts, giving up');
          return new Error('Redis reconnect failed');
        }
        return Math.min(retries * 100, 3000);
      },
    },
  }) as RedisClientType;

  redisClient.on('error', (err: Error) => {
    logger.error('Redis client error:', err);
  });

  redisClient.on('connect', () => {
    logger.info('Redis client connected');
  });

  redisClient.on('reconnecting', () => {
    logger.warn('Redis client reconnecting...');
  });

  redisClient.on('ready', () => {
    logger.info('Redis client ready');
  });

  await redisClient.connect();
};

export const disconnectRedis = async (): Promise<void> => {
  if (redisClient) {
    await redisClient.quit();
    logger.info('Redis client disconnected');
  }
};
