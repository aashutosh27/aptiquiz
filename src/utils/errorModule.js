import pino from 'pino';
import crypto from 'crypto';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  ...(process.env.NODE_ENV !== 'production'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true },
        },
      }
    : {}),
});

export const ERROR_CODES = {
  ROOM_NOT_FOUND: {
    code: 'ROOM_NOT_FOUND',
    message: 'Room not found. Check the PIN and try again.',
    status: 404,
  },
  ROOM_LOCKED: {
    code: 'ROOM_LOCKED',
    message: 'This room is currently locked by the host.',
    status: 403,
  },
  ROOM_FULL: {
    code: 'ROOM_FULL',
    message: 'This room is full. Maximum capacity is 50 players.',
    status: 403,
  },
  GAME_ALREADY_STARTED: {
    code: 'GAME_ALREADY_STARTED',
    message: 'This game has already started. Ask the host to let you in.',
    status: 403,
  },
  DISQUALIFIED: {
    code: 'DISQUALIFIED',
    message: 'You have been disqualified from this room.',
    status: 403,
  },
  SESSION_EXPIRED: {
    code: 'SESSION_EXPIRED',
    message: 'Your session has ended. Please sign in again.',
    status: 401,
  },
  NOT_ALLOWED: {
    code: 'NOT_ALLOWED',
    message: 'You do not have permission to perform this action.',
    status: 403,
  },
  RATE_LIMITED: {
    code: 'RATE_LIMITED',
    message: 'You are doing that too quickly. Please wait a moment.',
    status: 429,
  },
  AI_UNAVAILABLE: {
    code: 'AI_UNAVAILABLE',
    message: 'Couldn’t generate questions right now. Try again, or type questions manually.',
    status: 503,
  },
  NETWORK_OFFLINE: {
    code: 'NETWORK_OFFLINE',
    message: 'You appear to be offline. Check your internet connection.',
    status: 503,
  },
  VALIDATION_ERROR: {
    code: 'VALIDATION_ERROR',
    message: 'Invalid input provided.',
    status: 400,
  },
  SERVER_ERROR: {
    code: 'SERVER_ERROR',
    message: 'Something went wrong on our side.',
    status: 500,
  },
};

export class AppError extends Error {
  constructor(codeOrKey, customMessage = null, technicalDetail = null) {
    const errorDef = ERROR_CODES[codeOrKey] || {
      code: codeOrKey,
      message: customMessage || 'An unexpected error occurred.',
      status: 400,
    };

    super(customMessage || errorDef.message);
    this.code = errorDef.code;
    this.userMessage = customMessage || errorDef.message;
    this.status = errorDef.status;
    this.technicalDetail = technicalDetail;
    this.errorId = `ERR-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  }
}

export function formatErrorForUser(err) {
  if (err instanceof AppError) {
    if (err.code === 'SERVER_ERROR') {
      return {
        code: err.code,
        message: `${err.userMessage} Reference: ${err.errorId}. Please try again.`,
        errorId: err.errorId,
      };
    }
    return {
      code: err.code,
      message: err.userMessage,
      errorId: err.errorId,
    };
  }

  const errorId = `ERR-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  logger.error({ err, errorId }, 'Unhandled application error');

  return {
    code: 'SERVER_ERROR',
    message: `Something went wrong on our side. Reference: ${errorId}. Please try again.`,
    errorId,
  };
}

export function expressErrorHandler(err, req, res, next) {
  const formatted = formatErrorForUser(err);
  const status = err.status || (err instanceof AppError ? err.status : 500);
  res.status(status).json(formatted);
}
