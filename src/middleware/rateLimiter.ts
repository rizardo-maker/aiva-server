import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { logger } from '../utils/logger';

// Store for tracking rate limits per user
const userLimits = new Map<string, { count: number; resetTime: number }>();

// Custom rate limiter for authenticated users
export const createUserRateLimit = (windowMs: number, max: number) => {
  return (req: Request, res: Response, next: Function) => {
    const userId = req.user?.userId;
    
    if (!userId) {
      return next();
    }

    const now = Date.now();
    const userLimit = userLimits.get(userId);

    if (!userLimit || now > userLimit.resetTime) {
      // Reset or create new limit
      userLimits.set(userId, {
        count: 1,
        resetTime: now + windowMs
      });
      return next();
    }

    if (userLimit.count >= max) {
      logger.warn(`Rate limit exceeded for user: ${userId}`);
      return res.status(429).json({
        error: 'Too many requests',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter: Math.ceil((userLimit.resetTime - now) / 1000)
      });
    }

    userLimit.count++;
    next();
  };
};

// General rate limiters
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs (increased for development)
  message: {
    error: 'Too many requests',
    message: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`General rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many requests',
      message: 'Too many requests from this IP, please try again later.'
    });
  }
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 auth requests per windowMs
  message: {
    error: 'Too many authentication attempts',
    message: 'Too many authentication attempts, please try again later.'
  },
  skipSuccessfulRequests: true,
  handler: (req, res) => {
    logger.warn(`Auth rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many authentication attempts',
      message: 'Too many authentication attempts, please try again later.'
    });
  }
});

export const chatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // limit each IP to 100 chat requests per minute (increased for development)
  message: {
    error: 'Too many chat requests',
    message: 'Too many chat requests, please slow down.'
  },
  handler: (req, res) => {
    logger.warn(`Chat rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many chat requests',
      message: 'Too many chat requests, please slow down.'
    });
  }
});

export const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // limit each IP to 10 uploads per minute
  message: {
    error: 'Too many upload requests',
    message: 'Too many upload requests, please wait before uploading more files.'
  },
  handler: (req, res) => {
    logger.warn(`Upload rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many upload requests',
      message: 'Too many upload requests, please wait before uploading more files.'
    });
  }
});

// AI-specific rate limiter for expensive operations
export const aiLimiter = createUserRateLimit(60 * 1000, 100); // 100 AI requests per minute per user (increased for development)

// Cleanup expired user limits periodically
setInterval(() => {
  const now = Date.now();
  for (const [userId, limit] of userLimits.entries()) {
    if (now > limit.resetTime) {
      userLimits.delete(userId);
    }
  }
}, 5 * 60 * 1000); // Clean up every 5 minutes