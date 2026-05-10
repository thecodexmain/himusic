import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { config } from './index';
import { logger } from '../utils/logger';
import jwt from 'jsonwebtoken';
import { JwtPayload } from '../types';

let io: SocketIOServer;

export const getIO = (): SocketIOServer => {
  if (!io) throw new Error('Socket.IO not initialized');
  return io;
};

export const initSocket = (httpServer: HttpServer): SocketIOServer => {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: config.clientUrl,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      return next(new Error('Authentication token missing'));
    }
    try {
      const payload = jwt.verify(token, config.jwt.accessSecret) as JwtPayload;
      (socket as Socket & { userId: string }).userId = payload.sub;
      next();
    } catch {
      next(new Error('Invalid authentication token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const userId = (socket as Socket & { userId: string }).userId;
    logger.info(`Socket connected: ${socket.id} (user: ${userId})`);

    socket.join(`user:${userId}`);

    socket.on('join:playlist', (playlistId: string) => {
      socket.join(`playlist:${playlistId}`);
      logger.debug(`Socket ${socket.id} joined playlist:${playlistId}`);
    });

    socket.on('leave:playlist', (playlistId: string) => {
      socket.leave(`playlist:${playlistId}`);
    });

    socket.on('now:playing', (data: { youtubeId: string; title: string; artist: string }) => {
      socket.to(`user:${userId}`).emit('friend:playing', {
        userId,
        ...data,
        timestamp: new Date().toISOString(),
      });
    });

    socket.on('disconnect', (reason: string) => {
      logger.info(`Socket disconnected: ${socket.id} (reason: ${reason})`);
    });
  });

  logger.info('Socket.IO initialized');
  return io;
};
