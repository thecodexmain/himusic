import { config } from '../config';
import { CacheService } from './cache.service';
import { ApiError } from '../utils/ApiError';
import { logger } from '../utils/logger';
import {
  SongResult,
  ArtistResult,
  AlbumResult,
  PlaylistResult,
  SearchResult,
} from '../types';

const cache = new CacheService();

interface InnertubeContext {
  client: {
    clientName: string;
    clientVersion: string;
    hl: string;
    gl: string;
    userAgent: string;
  };
}

interface InnertubeRequestBody {
  context: InnertubeContext;
  query: string;
  params?: string;
}

const INNERTUBE_API_KEY = 'AIzaSyC9XL3ZjWdtnsv13D4uE0USw';
const YTM_BASE_URL = 'https://music.youtube.com/youtubei/v1';
const CLIENT_VERSION = '1.20240101.01.00';

const buildContext = (): InnertubeContext => ({
  client: {
    clientName: 'WEB_REMIX',
    clientVersion: CLIENT_VERSION,
    hl: 'en',
    gl: 'US',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  },
});

const ytmFetch = async <T>(
  endpoint: string,
  body: InnertubeRequestBody
): Promise<T> => {
  const url = `${YTM_BASE_URL}/${endpoint}?key=${INNERTUBE_API_KEY}&prettyPrint=false`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-YouTube-Client-Name': '67',
      'X-YouTube-Client-Version': CLIENT_VERSION,
      Referer: 'https://music.youtube.com/',
      Origin: 'https://music.youtube.com',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new ApiError(502, `YouTube Music API error: ${res.status}`);
  }

  return res.json() as Promise<T>;
};

const extractText = (obj: unknown): string => {
  if (!obj || typeof obj !== 'object') return '';
  const o = obj as Record<string, unknown>;
  if (typeof o['text'] === 'string') return o['text'];
  if (Array.isArray(o['runs'])) {
    return (o['runs'] as Array<{ text?: string }>)
      .map((r) => r.text ?? '')
      .join('');
  }
  return '';
};

const extractThumbnail = (thumbnails: Array<{ url: string }>): string => {
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) return '';
  return thumbnails[thumbnails.length - 1]?.url ?? '';
};

const parseDuration = (durationStr: string): number => {
  if (!durationStr) return 0;
  const parts = durationStr.split(':').map(Number);
  if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  if (parts.length === 3)
    return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  return 0;
};

const parseSongRenderer = (renderer: Record<string, unknown>): SongResult | null => {
  try {
    const videoId = renderer['videoId'] as string;
    if (!videoId) return null;

    const title = extractText(renderer['title']);
    const flexCols = renderer['flexColumns'] as Array<{
      musicResponsiveListItemFlexColumnRenderer?: {
        text?: unknown;
      };
    }>;

    let artist = 'Unknown Artist';
    let album = '';

    if (Array.isArray(flexCols) && flexCols.length > 1) {
      const subtitleRuns = (
        flexCols[1]?.musicResponsiveListItemFlexColumnRenderer?.text as
          | { runs?: Array<{ text?: string; navigationEndpoint?: unknown }> }
          | undefined
      )?.runs ?? [];

      const textParts = subtitleRuns
        .filter((r) => r.text && r.text !== ' • ')
        .map((r) => r.text ?? '');

      artist = textParts[0] ?? artist;
      album = textParts[2] ?? album;
    }

    const thumbnails = (
      (renderer['thumbnail'] as { musicThumbnailRenderer?: { thumbnail?: { thumbnails?: Array<{ url: string }> } } })
        ?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? []
    );
    const thumbnail = extractThumbnail(thumbnails);

    const durationStr = extractText(renderer['fixedColumns']
      ? (renderer['fixedColumns'] as Array<{ musicResponsiveListItemFixedColumnRenderer?: { text?: unknown } }>)[0]
          ?.musicResponsiveListItemFixedColumnRenderer?.text
      : null);
    const duration = parseDuration(durationStr);

    return { youtubeId: videoId, title, artist, album, thumbnail, duration };
  } catch {
    return null;
  }
};

interface YtmSearchResponse {
  contents?: {
    tabbedSearchResultsRenderer?: {
      tabs?: Array<{
        tabRenderer?: {
          content?: {
            sectionListRenderer?: {
              contents?: Array<{
                musicShelfRenderer?: {
                  contents?: Array<{
                    musicResponsiveListItemRenderer?: Record<string, unknown>;
                  }>;
                };
              }>;
            };
          };
        };
      }>;
    };
  };
}

export class SearchService {
  async search(query: string, type: 'all' | 'songs' | 'artists' | 'albums' | 'playlists' = 'all'): Promise<SearchResult> {
    const cacheKey = `search:${type}:${query.toLowerCase().trim()}`;

    const cached = await cache.get<SearchResult>(cacheKey);
    if (cached) return cached;

    logger.info(`Searching YouTube Music: "${query}" (type: ${type})`);

    const body: InnertubeRequestBody = {
      context: buildContext(),
      query,
    };

    let data: YtmSearchResponse;
    try {
      data = await ytmFetch<YtmSearchResponse>('search', body);
    } catch (err) {
      logger.error('YouTube Music search failed:', err);
      throw new ApiError(502, 'Search service temporarily unavailable');
    }

    const result: SearchResult = {
      songs: [],
      artists: [],
      albums: [],
      playlists: [],
    };

    try {
      const tabs =
        data?.contents?.tabbedSearchResultsRenderer?.tabs ?? [];

      for (const tab of tabs) {
        const sections =
          tab?.tabRenderer?.content?.sectionListRenderer?.contents ?? [];

        for (const section of sections) {
          const shelf = section?.musicShelfRenderer;
          if (!shelf) continue;

          const items = shelf.contents ?? [];
          for (const item of items) {
            const renderer = item?.musicResponsiveListItemRenderer;
            if (!renderer) continue;

            const song = parseSongRenderer(renderer);
            if (song) result.songs.push(song);
          }
        }
      }
    } catch (err) {
      logger.warn('Error parsing search results:', err);
    }

    await cache.set(cacheKey, result, config.cache.ttlSearch);
    return result;
  }

  async searchSongs(query: string): Promise<SongResult[]> {
    const result = await this.search(query, 'songs');
    return result.songs;
  }

  async searchArtists(query: string): Promise<ArtistResult[]> {
    const result = await this.search(query, 'artists');
    return result.artists;
  }

  async searchAlbums(query: string): Promise<AlbumResult[]> {
    const result = await this.search(query, 'albums');
    return result.albums;
  }

  async searchPlaylists(query: string): Promise<PlaylistResult[]> {
    const result = await this.search(query, 'playlists');
    return result.playlists;
  }

  async getTrending(region = 'US'): Promise<SongResult[]> {
    const cacheKey = `trending:${region}`;

    return cache.getOrSet(
      cacheKey,
      async () => {
        const trendingQueries = [
          'top hits 2024',
          'trending music',
          'popular songs today',
        ];
        const query = trendingQueries[Math.floor(Math.random() * trendingQueries.length)] ?? 'top hits 2024';
        const result = await this.search(query, 'songs');
        return result.songs.slice(0, 20);
      },
      config.cache.ttlTrending
    );
  }
}

export const searchService = new SearchService();
