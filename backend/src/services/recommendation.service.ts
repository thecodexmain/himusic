import { prisma } from '../utils/prisma';
import { CacheService } from './cache.service';
import { searchService } from './search.service';
import { SongResult } from '../types';
import { config } from '../config';
import { logger } from '../utils/logger';

const cache = new CacheService();

export class RecommendationService {
  async getForUser(userId: string): Promise<SongResult[]> {
    const cacheKey = `recommendations:${userId}`;
    const cached = await cache.get<SongResult[]>(cacheKey);
    if (cached) return cached;

    const [recentHistory, likedSongs] = await Promise.all([
      prisma.history.findMany({
        where: { userId },
        orderBy: { playedAt: 'desc' },
        take: 20,
        select: { youtubeId: true, title: true, artist: true },
      }),
      prisma.likedSong.findMany({
        where: { userId },
        orderBy: { likedAt: 'desc' },
        take: 10,
        select: { youtubeId: true, title: true, artist: true },
      }),
    ]);

    const recommendations = await this.buildRecommendations(
      recentHistory,
      likedSongs
    );

    await cache.set(cacheKey, recommendations, config.cache.ttlRecommendations);
    return recommendations;
  }

  private async buildRecommendations(
    history: Array<{ youtubeId: string; title: string; artist: string }>,
    liked: Array<{ youtubeId: string; title: string; artist: string }>
  ): Promise<SongResult[]> {
    const seenIds = new Set<string>();
    const allSources = [...liked, ...history];
    const results: SongResult[] = [];

    const artistCounts = new Map<string, number>();
    for (const item of allSources) {
      const count = artistCounts.get(item.artist) ?? 0;
      artistCounts.set(item.artist, count + 1);
    }

    const topArtists = [...artistCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([artist]) => artist);

    const queries = [
      ...topArtists.map((a) => `${a} songs`),
      'trending music',
    ];

    for (const [index, source] of allSources.slice(0, 5).entries()) {
      if (index < 3) queries.push(`similar to ${source.title} ${source.artist}`);
    }

    const uniqueQueries = [...new Set(queries)].slice(0, 5);

    const searchPromises = uniqueQueries.map((q) =>
      searchService.searchSongs(q).catch((err) => {
        logger.warn(`Recommendation search failed for "${q}":`, err);
        return [] as SongResult[];
      })
    );

    const searchResults = await Promise.all(searchPromises);

    const excludedIds = new Set([
      ...history.map((h) => h.youtubeId),
      ...liked.map((l) => l.youtubeId),
    ]);

    for (const songs of searchResults) {
      for (const song of songs) {
        if (!seenIds.has(song.youtubeId) && !excludedIds.has(song.youtubeId)) {
          seenIds.add(song.youtubeId);
          results.push(song);
          if (results.length >= 30) break;
        }
      }
      if (results.length >= 30) break;
    }

    if (results.length < 10) {
      const fallback = await searchService.getTrending();
      for (const song of fallback) {
        if (!seenIds.has(song.youtubeId)) {
          seenIds.add(song.youtubeId);
          results.push(song);
          if (results.length >= 20) break;
        }
      }
    }

    return results.slice(0, 30);
  }

  async getNewUser(): Promise<SongResult[]> {
    return cache.getOrSet(
      'recommendations:new-user',
      () => searchService.getTrending(),
      config.cache.ttlTrending
    );
  }

  async invalidateForUser(userId: string): Promise<void> {
    await cache.del(`recommendations:${userId}`);
  }
}

export const recommendationService = new RecommendationService();
