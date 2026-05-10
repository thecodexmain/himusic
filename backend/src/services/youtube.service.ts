import { spawn } from 'child_process';
import { CacheService } from './cache.service';
import { ApiError } from '../utils/ApiError';
import { logger } from '../utils/logger';
import { config } from '../config';
import { StreamUrlResult } from '../types';

const cache = new CacheService();

const runYtDlp = (args: string[]): Promise<string> => {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args, { timeout: 30000 });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        reject(new ApiError(503, 'yt-dlp is not installed on this server'));
      } else {
        reject(new ApiError(500, `Failed to spawn yt-dlp: ${err.message}`));
      }
    });

    proc.on('close', (code: number | null) => {
      if (code !== 0) {
        logger.error(`yt-dlp exited with code ${code}: ${stderr}`);
        if (stderr.includes('Video unavailable')) {
          reject(new ApiError(404, 'Video is unavailable'));
        } else if (stderr.includes('Private video')) {
          reject(new ApiError(403, 'This video is private'));
        } else {
          reject(new ApiError(500, 'Failed to extract stream URL'));
        }
      } else {
        resolve(stdout.trim());
      }
    });
  });
};

export const getYoutubeAudioUrl = async (
  youtubeId: string
): Promise<StreamUrlResult> => {
  const cacheKey = `stream:${youtubeId}`;

  const cached = await cache.get<StreamUrlResult>(cacheKey);
  if (cached) {
    return { ...cached, cached: true };
  }

  const youtubeUrl = `https://www.youtube.com/watch?v=${youtubeId}`;

  logger.info(`Extracting audio URL for: ${youtubeId}`);

  const [audioUrl, metaJson] = await Promise.all([
    runYtDlp([
      '-f', 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio',
      '--get-url',
      '--no-playlist',
      youtubeUrl,
    ]),
    runYtDlp([
      '--dump-single-json',
      '--no-playlist',
      '--skip-download',
      youtubeUrl,
    ]),
  ]);

  let title = youtubeId;
  let artist = 'Unknown Artist';
  let thumbnail = '';
  let duration = 0;

  try {
    const meta = JSON.parse(metaJson) as {
      title?: string;
      uploader?: string;
      channel?: string;
      thumbnail?: string;
      duration?: number;
    };
    title = meta.title ?? title;
    artist = meta.uploader ?? meta.channel ?? artist;
    thumbnail = meta.thumbnail ?? thumbnail;
    duration = meta.duration ?? duration;
  } catch {
    logger.warn(`Failed to parse yt-dlp metadata for ${youtubeId}`);
  }

  const expiresAt = new Date(
    Date.now() + config.cache.ttlStream * 1000
  ).toISOString();

  const result: StreamUrlResult = {
    youtubeId,
    audioUrl,
    title,
    artist,
    thumbnail,
    duration,
    expiresAt,
    cached: false,
  };

  await cache.set(cacheKey, result, config.cache.ttlStream);

  return result;
};

export const searchYoutubeAudio = async (
  query: string,
  maxResults = 5
): Promise<Array<{ youtubeId: string; title: string; artist: string; thumbnail: string; duration: number }>> => {
  const cacheKey = `yt-search:${query}:${maxResults}`;
  const cached = await cache.get<Array<{ youtubeId: string; title: string; artist: string; thumbnail: string; duration: number }>>(cacheKey);
  if (cached) return cached;

  const output = await runYtDlp([
    `ytsearch${maxResults}:${query}`,
    '--dump-json',
    '--no-playlist',
    '--skip-download',
    '--flat-playlist',
  ]);

  const results = output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        const item = JSON.parse(line) as {
          id?: string;
          title?: string;
          uploader?: string;
          channel?: string;
          thumbnail?: string;
          duration?: number;
        };
        return {
          youtubeId: item.id ?? '',
          title: item.title ?? '',
          artist: item.uploader ?? item.channel ?? 'Unknown',
          thumbnail: item.thumbnail ?? '',
          duration: item.duration ?? 0,
        };
      } catch {
        return null;
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null && item.youtubeId !== '');

  await cache.set(cacheKey, results, config.cache.ttlSearch);
  return results;
};
