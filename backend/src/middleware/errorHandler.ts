import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/ApiError';
import { ApiResponse } from '../utils/ApiResponse';
import { logger } from '../utils/logger';
import { config } from '../config';
import { Prisma } from '@prisma/client';

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  logger.error({
    message: err.message,
    stack: config.isDev ? err.stack : undefined,
    path: req.path,
    method: req.method,
  });

  if (err instanceof ApiError) {
    res.status(err.statusCode).json(
      ApiResponse.error(err.message, err.errors)
    );
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json(ApiResponse.error('A record with this data already exists'));
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json(ApiResponse.error('Record not found'));
      return;
    }
    if (err.code === 'P2003') {
      res.status(400).json(ApiResponse.error('Foreign key constraint violation'));
      return;
    }
    res.status(400).json(ApiResponse.error('Database request error'));
    return;
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    res.status(400).json(ApiResponse.error('Invalid data provided'));
    return;
  }

  if (err.name === 'SyntaxError') {
    res.status(400).json(ApiResponse.error('Invalid JSON in request body'));
    return;
  }

  const statusCode = res.statusCode !== 200 ? res.statusCode : 500;
  res.status(statusCode).json(
    ApiResponse.error(
      config.isDev ? err.message : 'Internal server error',
      config.isDev ? [err.stack ?? ''] : undefined
    )
  );
};

export const notFoundHandler = (req: Request, _res: Response, next: NextFunction): void => {
  next(new ApiError(404, `Route ${req.method} ${req.path} not found`));
};
