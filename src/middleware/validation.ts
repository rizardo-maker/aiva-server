import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { logger } from '../utils/logger';
import { app } from '..';
import { securityHeaders, securityLogger } from './security';

export interface ValidationSchema {
  body?: Joi.ObjectSchema;
  query?: Joi.ObjectSchema;
  params?: Joi.ObjectSchema;
}

export const validate = (schema: ValidationSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const errors: string[] = [];

    // Validate request body
    if (schema.body) {
      const { error } = schema.body.validate(req.body);
      if (error) {
        errors.push(`Body: ${error.details[0].message}`);
      }
    }

    // Validate query parameters
    if (schema.query) {
      const { error } = schema.query.validate(req.query);
      if (error) {
        errors.push(`Query: ${error.details[0].message}`);
      }
    }

    // Validate route parameters
    if (schema.params) {
      const { error } = schema.params.validate(req.params);
      if (error) {
        errors.push(`Params: ${error.details[0].message}`);
      }
    }

    if (errors.length > 0) {
      logger.warn('Validation failed:', { errors, url: req.url, method: req.method });
      return res.status(400).json({
        error: 'Validation failed',
        details: errors
      });
    }

    next();
  };
};

// Common validation schemas
export const schemas = {
  // User schemas
  register: {
    body: Joi.object({
      firstName: Joi.string().min(2).max(50).required(),
      lastName: Joi.string().min(2).max(50).required(),
      email: Joi.string().email().required(),
      password: Joi.string().min(8).max(128).required()
        .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
        .message('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character')
    })
  },

  login: {
    body: Joi.object({
      email: Joi.string().email().required(),
      password: Joi.string().required()
    })
  },

  updateProfile: {
    body: Joi.object({
      firstName: Joi.string().min(2).max(50),
      lastName: Joi.string().min(2).max(50),
      preferences: Joi.object({
        theme: Joi.string().valid('light', 'dark'),
        language: Joi.string().min(2).max(5),
        notifications: Joi.boolean(),
        timezone: Joi.string()
      })
    })
  },

  // Chat schemas
  createChat: {
    body: Joi.object({
      title: Joi.string().min(1).max(200).required(),
      description: Joi.string().max(500),
      workspaceId: Joi.string().uuid()
    })
  },

  sendMessage: {
    body: Joi.object({
      message: Joi.string().min(1).max(4000).required(),
      chatId: Joi.string().uuid(),
      parentMessageId: Joi.string().uuid(),
      datasetId: Joi.string().uuid(),
      workspaceId: Joi.string().uuid(),
      useDataAgent: Joi.boolean()
    })
  },

  // Workspace schemas
  createWorkspace: {
    body: Joi.object({
      name: Joi.string().min(1).max(200).required(),
      description: Joi.string().max(1000).allow(''),
      color: Joi.string().pattern(/^#[0-9A-F]{6}$/i).allow(''),
      isShared: Joi.boolean().allow(null)
    })
  },

  updateWorkspace: {
    body: Joi.object({
      name: Joi.string().min(1).max(200),
      description: Joi.string().max(1000),
      color: Joi.string().pattern(/^#[0-9A-F]{6}$/i),
      isShared: Joi.boolean()
    })
  },

  assignUsersToWorkspace: {
    body: Joi.object({
      userIds: Joi.array().items(Joi.string().uuid()).min(1).required(),
      accessLevel: Joi.string().valid('member', 'readonly').default('member')
    })
  },

  removeUsersFromWorkspace: {
    body: Joi.object({
      userIds: Joi.array().items(Joi.string().uuid()).min(1).required()
    })
  },

  updateUserAccess: {
    body: Joi.object({
      userId: Joi.string().uuid().required(),
      accessLevel: Joi.string().valid('member', 'readonly').required()
    })
  },

  // File schemas
  uploadFile: {
    body: Joi.object({
      chatId: Joi.string().uuid(),
      messageId: Joi.string().uuid()
    })
  },

  // Common parameter schemas
  uuidParam: {
    params: Joi.object({
      id: Joi.string().uuid().required()
    })
  },

  chatIdParam: {
    params: Joi.object({
      chatId: Joi.string().uuid().required()
    })
  },

  messageIdParam: {
    params: Joi.object({
      messageId: Joi.string().uuid().required()
    })
  },

  // Pagination schema
  pagination: {
    query: Joi.object({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(100).default(20),
      sortBy: Joi.string().valid('createdAt', 'updatedAt', 'name', 'title'),
      sortOrder: Joi.string().valid('asc', 'desc').default('desc')
    })
  },

  // Search schema
  search: {
    query: Joi.object({
      q: Joi.string().min(1).max(200).required(),
      type: Joi.string().valid('chats', 'messages', 'files'),
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(50).default(10)
    })
  }
};

// Sanitization middleware
export const sanitize = (req: Request, res: Response, next: NextFunction) => {
  // Remove any potential XSS attempts
  const sanitizeObject = (obj: any): any => {
    if (typeof obj === 'string') {
      return obj.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                .replace(/javascript:/gi, '')
                .replace(/on\w+\s*=/gi, '');
    }
    
    if (Array.isArray(obj)) {
      return obj.map(sanitizeObject);
    }
    
    if (obj && typeof obj === 'object') {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(obj)) {
        sanitized[key] = sanitizeObject(value);
      }
      return sanitized;
    }
    
    return obj;
  };

  req.body = sanitizeObject(req.body);
  req.query = sanitizeObject(req.query);
  
  next();
};
// Security middleware
// Note: Security headers and loggers should be applied in the main app file, not here
// These were causing errors as 'app' is not defined in this context

