import { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import { logger } from '../utils/logger';

// Enhanced security headers
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", "https://api.openai.com", "https://*.openai.azure.com"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false, // Disable for file uploads
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
});

// Request size limiter
export const requestSizeLimiter = (req: Request, res: Response, next: NextFunction) => {
  const maxSize = 10 * 1024 * 1024; // 10MB
  
  if (req.headers['content-length']) {
    const contentLength = parseInt(req.headers['content-length']);
    if (contentLength > maxSize) {
      logger.warn(`Request too large: ${contentLength} bytes from ${req.ip}`);
      return res.status(413).json({
        error: 'Request too large',
        message: 'Request size exceeds maximum allowed limit'
      });
    }
  }
  
  next();
};

// IP whitelist/blacklist middleware
export const ipFilter = (req: Request, res: Response, next: NextFunction) => {
  const clientIP = req.ip || req.connection.remoteAddress;
  
  // Add your IP filtering logic here
  const blacklistedIPs = process.env.BLACKLISTED_IPS?.split(',') || [];
  const whitelistedIPs = process.env.WHITELISTED_IPS?.split(',') || [];
  
  if (clientIP && blacklistedIPs.includes(clientIP)) {
    logger.warn(`Blocked request from blacklisted IP: ${clientIP}`);
    return res.status(403).json({
      error: 'Access denied',
      message: 'Your IP address is not allowed to access this service'
    });
  }
  
  // If whitelist is configured, only allow whitelisted IPs
  if (whitelistedIPs.length > 0 && clientIP && !whitelistedIPs.includes(clientIP)) {
    logger.warn(`Blocked request from non-whitelisted IP: ${clientIP}`);
    return res.status(403).json({
      error: 'Access denied',
      message: 'Your IP address is not allowed to access this service'
    });
  }
  
  next();
};

// Request logging for security monitoring
export const securityLogger = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  
  // Log suspicious patterns
  const suspiciousPatterns = [
    /\.\./,  // Directory traversal
    /<script/i,  // XSS attempts
    /union.*select/i,  // SQL injection
    /javascript:/i,  // JavaScript injection
    /eval\(/i,  // Code injection
  ];
  
  const url = req.url.toLowerCase();
  const userAgent = req.get('User-Agent') || '';
  const body = JSON.stringify(req.body).toLowerCase();
  
  const isSuspicious = suspiciousPatterns.some(pattern => 
    pattern.test(url) || pattern.test(userAgent) || pattern.test(body)
  );
  
  if (isSuspicious) {
    logger.warn('Suspicious request detected', {
      ip: req.ip,
      method: req.method,
      url: req.url,
      userAgent,
      body: req.body
    });
  }
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    
    // Log slow requests
    if (duration > 5000) {
      logger.warn('Slow request detected', {
        ip: req.ip,
        method: req.method,
        url: req.url,
        duration,
        statusCode: res.statusCode
      });
    }
    
    // Log error responses
    if (res.statusCode >= 400) {
      logger.warn('Error response', {
        ip: req.ip,
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        duration
      });
    }
  });
  
  next();
};

// CORS configuration
export const corsOptions = {
  origin: (origin: string | undefined, callback: Function) => {
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
      'http://localhost:3000',
      'http://localhost:5173',
      'https://yourdomain.com'
    ];
    
    // Allow requests with no origin (mobile apps, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn(`CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'X-API-Key',
    'x-admin-email',
    // Allow mobile dev user context headers so backend can map correct user
    'x-user-id',
    'x-user-email'
  ],
  exposedHeaders: ['X-Total-Count', 'X-Page-Count'],
  maxAge: 86400 // 24 hours
};

// API key validation middleware
export const validateApiKey = (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.header('X-API-Key');
  const validApiKeys = process.env.API_KEYS?.split(',') || [];
  
  if (validApiKeys.length === 0) {
    return next(); // No API key validation if none configured
  }
  
  if (!apiKey || !validApiKeys.includes(apiKey)) {
    logger.warn(`Invalid API key attempt from ${req.ip}`);
    return res.status(401).json({
      error: 'Invalid API key',
      message: 'A valid API key is required to access this endpoint'
    });
  }
  
  next();
};

// Content type validation
export const validateContentType = (allowedTypes: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const contentType = req.get('Content-Type');
    
    if (req.method === 'POST' || req.method === 'PUT') {
      if (!contentType || !allowedTypes.some(type => contentType.includes(type))) {
        return res.status(415).json({
          error: 'Unsupported Media Type',
          message: `Content-Type must be one of: ${allowedTypes.join(', ')}`
        });
      }
    }
    
    next();
  };
};