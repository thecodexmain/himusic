export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface SongResult {
  youtubeId: string;
  title: string;
  artist: string;
  album?: string;
  thumbnail: string;
  duration: number;
  views?: number;
}

export interface SearchResult {
  songs: SongResult[];
  artists: ArtistResult[];
  albums: AlbumResult[];
  playlists: PlaylistResult[];
}

export interface ArtistResult {
  id: string;
  name: string;
  thumbnail: string;
  subscribers?: string;
}

export interface AlbumResult {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  year?: number;
}

export interface PlaylistResult {
  id: string;
  title: string;
  author: string;
  thumbnail: string;
  trackCount?: number;
}

export interface StreamUrlResult {
  youtubeId: string;
  audioUrl: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration: number;
  expiresAt: string;
  cached: boolean;
}

export interface PaginationQuery {
  page?: string;
  limit?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface YouTubeMusicSearchResponse {
  contents?: unknown;
  header?: unknown;
}

export interface InnertubeSearchItem {
  videoId: string;
  title: string;
  artists?: Array<{ name: string }>;
  album?: { name: string };
  thumbnails?: Array<{ url: string; width: number; height: number }>;
  duration?: number;
  isVideo?: boolean;
}

export interface RecommendationInput {
  userId: string;
  recentHistory: Array<{ youtubeId: string; title: string; artist: string }>;
  likedSongs: Array<{ youtubeId: string; title: string; artist: string }>;
}
