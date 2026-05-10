import { getRedisClient } from '../config/redis';
import { logger } from '../utils/logger';

export class CacheService {
  private client() {
    return getRedisClient();
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await this.client().get(key);
      if (!data) return null;
      return JSON.parse(data) as T;
    } catch (err) {
      logger.warn(`Cache get error for key "${key}":`, err);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds) {
        await this.client().setEx(key, ttlSeconds, serialized);
      } else {
        await this.client().set(key, serialized);
      }
    } catch (err) {
      logger.warn(`Cache set error for key "${key}":`, err);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client().del(key);
    } catch (err) {
      logger.warn(`Cache del error for key "${key}":`, err);
    }
  }

  async delPattern(pattern: string): Promise<void> {
    try {
      const keys = await this.client().keys(pattern);
      if (keys.length > 0) {
        await this.client().del(keys);
      }
    } catch (err) {
      logger.warn(`Cache delPattern error for pattern "${pattern}":`, err);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const count = await this.client().exists(key);
      return count > 0;
    } catch (err) {
      logger.warn(`Cache exists error for key "${key}":`, err);
      return false;
    }
  }

  async increment(key: string, ttlSeconds?: number): Promise<number> {
    try {
      const val = await this.client().incr(key);
      if (ttlSeconds && val === 1) {
        await this.client().expire(key, ttlSeconds);
      }
      return val;
    } catch (err) {
      logger.warn(`Cache increment error for key "${key}":`, err);
      return 0;
    }
  }

  async ttl(key: string): Promise<number> {
    try {
      return await this.client().ttl(key);
    } catch {
      return -1;
    }
  }

  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttlSeconds?: number
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const value = await factory();
    await this.set(key, value, ttlSeconds);
    return value;
  }
}

export const cacheService = new CacheService();
