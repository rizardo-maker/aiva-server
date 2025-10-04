import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';

// Extend Request interface to include user
declare global {
  namespace Express {
    interface Request {
      user: {
        userId: string;
        email: string;
        role?: string;
      };
    }
  }
}

export async function authenticateToken(req: any, res: any, next: any) {
  // Development mode: bypass authentication for testing Azure SQL integration
  if (process.env.NODE_ENV === 'development' && process.env.BYPASS_AUTH === 'true') {
    // Check if admin email is provided in headers
    const adminEmail = req.headers['x-admin-email'];
    if (adminEmail && (adminEmail === 'admin@alyasra.com' || adminEmail === 'sudhenreddym@gmail.com')) {
      // Map to the real admin user in database
      req.user = {
        userId: '7FC8F24A-5494-426C-93F2-61471A72D6AD',
        email: adminEmail,
        role: 'admin'
      };
    } else {
      // Map non-admin dev requests to a REAL database user using headers from mobile app
      try {
        const { DatabaseManager } = require('../config/database');
        const dbManager = DatabaseManager.getInstance();
        const pool = await dbManager.getPool();

        // Mobile app sends these for context in dev
        const userEmail = req.headers['x-user-email'];
        const userIdHeader = req.headers['x-user-id'];

        let dbUser: any = null;

        if (userIdHeader) {
          const result = await pool.request()
            .input('userId', userIdHeader)
            .query(`SELECT id, email, role FROM Users WHERE id = @userId`);
          if (result.recordset.length > 0) {
            dbUser = result.recordset[0];
            logger.info(`Dev BYPASS_AUTH: mapped user by ID -> ${dbUser.email} (${dbUser.id})`);
          }
        }

        if (!dbUser && userEmail) {
          const result = await pool.request()
            .input('email', userEmail)
            .query(`SELECT id, email, role FROM Users WHERE email = @email`);
          if (result.recordset.length > 0) {
            dbUser = result.recordset[0];
            logger.info(`Dev BYPASS_AUTH: mapped user by email -> ${dbUser.email} (${dbUser.id})`);
          }
        }

        if (!dbUser) {
          const result = await pool.request()
            .query(`SELECT TOP 1 id, email, role FROM Users WHERE role = 'user' ORDER BY createdAt DESC`);
          if (result.recordset.length > 0) {
            dbUser = result.recordset[0];
            logger.info(`Dev BYPASS_AUTH: using latest DB user -> ${dbUser.email} (${dbUser.id})`);
          }
        }

        // If the mapped user has no workspace assignments, fall back to a user who does
        if (dbUser) {
          const assignCount = await pool.request()
            .input('userId', dbUser.id)
            .query(`SELECT COUNT(*) as cnt FROM WorkspaceUsers WHERE userId = @userId`);
          const cnt = assignCount.recordset[0]?.cnt || 0;
          if (cnt === 0) {
            const alt = await pool.request()
              .query(`SELECT TOP 1 u.id, u.email, u.role
                      FROM Users u
                      INNER JOIN WorkspaceUsers wu ON u.id = wu.userId
                      ORDER BY wu.assignedAt DESC`);
            if (alt.recordset.length > 0) {
              dbUser = alt.recordset[0];
              logger.info(`Dev BYPASS_AUTH: switched to assigned user -> ${dbUser.email} (${dbUser.id})`);
            } else {
              logger.warn('Dev BYPASS_AUTH: no users with workspace assignments found');
            }
          }
        }

        if (dbUser) {
          req.user = {
            userId: dbUser.id,
            email: dbUser.email,
            role: dbUser.role || 'user'
          };
        } else {
          // Final fallback
          req.user = {
            userId: 'dev-user-123',
            email: 'dev@example.com',
            role: 'user'
          };
          logger.warn('Dev BYPASS_AUTH: No DB user found, using fallback dev user');
        }
      } catch (mapError) {
        logger.error('Dev BYPASS_AUTH: error mapping to real user:', mapError);
        req.user = {
          userId: 'dev-user-123',
          email: 'dev@example.com',
          role: 'user'
        };
      }
    }
    return next();
  }

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  // Development mode: handle mock token from mobile app
  if (process.env.NODE_ENV === 'development' && (token === 'mock-dev-token-for-testing' || token === 'admin-token-placeholder')) {
    logger.info('Using mock authentication token for development');
    // Check if admin email is provided in headers
    const adminEmail = req.headers['x-admin-email'];
    if (adminEmail && (adminEmail === 'admin@alyasra.com' || adminEmail === 'sudhenreddym@gmail.com')) {
      // Map to the real admin user in database
      req.user = {
        userId: '7FC8F24A-5494-426C-93F2-61471A72D6AD',
        email: adminEmail,
        role: 'admin'
      };
    } else {
      // For regular users, try to get their actual user ID from the database
      // This ensures workspace assignments work correctly
      try {
        const { DatabaseManager } = require('../config/database');
        const dbManager = DatabaseManager.getInstance();
        const pool = await dbManager.getPool();
        
        // Check if we have user context headers from the mobile app
        const userEmail = req.headers['x-user-email'];
        const userId = req.headers['x-user-id'];
        
        let dbUser = null;
        
        if (userId) {
          // Try to find user by ID first
          const result = await pool.request()
            .input('userId', userId)
            .query(`SELECT id, email, role FROM Users WHERE id = @userId`);
          
          if (result.recordset.length > 0) {
            dbUser = result.recordset[0];
            logger.info(`Found user by ID: ${dbUser.email} (${dbUser.id})`);
          }
        }
        
        if (!dbUser && userEmail) {
          // Try to find user by email
          const result = await pool.request()
            .input('email', userEmail)
            .query(`SELECT id, email, role FROM Users WHERE email = @email`);
          
          if (result.recordset.length > 0) {
            dbUser = result.recordset[0];
            logger.info(`Found user by email: ${dbUser.email} (${dbUser.id})`);
          }
        }
        
        if (!dbUser) {
          // Try to find any real user in the database for development
          const result = await pool.request()
            .query(`SELECT TOP 1 id, email, role FROM Users WHERE role = 'user' ORDER BY createdAt DESC`);
          
          if (result.recordset.length > 0) {
            dbUser = result.recordset[0];
            logger.info(`Using latest database user for development: ${dbUser.email} (${dbUser.id})`);
          }
        }
        
        if (dbUser) {
          req.user = {
            userId: dbUser.id,
            email: dbUser.email,
            role: dbUser.role
          };
        } else {
          // Fallback to mock user if no real users exist
          req.user = {
            userId: 'dev-user-123',
            email: 'dev@example.com',
            role: 'user'
          };
          logger.warn('No real users found in database, using mock user');
        }
      } catch (error) {
        logger.error('Error fetching real user for development:', error);
        // Fallback to mock user
        req.user = {
          userId: 'dev-user-123',
          email: 'dev@example.com',
          role: 'user'
        };
      }
    }
    return next();
  }

  if (!token) {
    return res.status(401).json({
      error: 'Access token required',
      message: 'Please provide a valid authentication token'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as any;
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role
    };
    next();
  } catch (error) {
    logger.error('Token verification failed:', error);
    
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({
        error: 'Token expired',
        message: 'Please login again'
      });
    }
    
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({
        error: 'Invalid token',
        message: 'Please provide a valid authentication token'
      });
    }
    
    return res.status(401).json({
      error: 'Authentication failed',
      message: 'Token verification failed'
    });
  }
}

// Optional authentication middleware (for public endpoints that can benefit from user context)
export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return next(); // Continue without user context
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as any;
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role
    };
  } catch (error) {
    // Ignore token errors for optional auth
    logger.warn('Optional auth token verification failed:', error);
  }

  next();
}

// Admin role middleware
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required',
      message: 'Please login to access this resource'
    });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Access denied',
      message: 'Admin access required'
    });
  }

  next();
}