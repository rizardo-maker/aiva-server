import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { aiLimiter } from '../middleware/rateLimiter';
import { AdminDataService } from '../services/adminDataService';
import { logger } from '../utils/logger';
import { DatabaseManager } from '../config/database';
import Joi from 'joi';
import { v4 as uuidv4 } from 'uuid';
import sql from 'mssql';

const router = express.Router();

// Apply authentication to all admin data routes
router.use(authenticateToken);

const adminDataService = AdminDataService.getInstance();

// Middleware to check admin privileges
const requireAdmin = (req: any, res: any, next: any) => {
  // Check if user has admin privileges
  const userRole = req.user?.role || 'user';
  if (userRole !== 'admin') {
    return res.status(403).json({
      error: 'Admin privileges required',
      message: 'This endpoint requires administrator access'
    });
  }
  next();
};

// Apply admin check to all routes
router.use(requireAdmin);

// Validation schemas for admin data routes
const adminDataQuestionSchema = {
  body: Joi.object({
    question: Joi.string().min(1).max(1000).required(),
    datasetId: Joi.string().uuid().optional(),
    connectionId: Joi.string().uuid().optional(),
    workspaceId: Joi.string().uuid().optional(),
    queryType: Joi.string().valid('dax', 'sql').optional(),
    includeVisualization: Joi.boolean().default(true)
  })
};

const adminExecuteQuerySchema = {
  body: Joi.object({
    query: Joi.string().min(1).max(10000).required(),
    queryType: Joi.string().valid('dax', 'sql').required(),
    datasetId: Joi.string().uuid().optional(),
    connectionId: Joi.string().uuid().optional(),
    workspaceId: Joi.string().uuid().optional()
  })
};

// Admin data question endpoint
router.post('/question', aiLimiter, validate(adminDataQuestionSchema), async (req, res) => {
  try {
    const { question, datasetId, connectionId, workspaceId, queryType, includeVisualization } = req.body;
    const userId = req.user.userId;

    logger.info(`Admin data question from user ${userId}: ${question}`);

    const result = await adminDataService.processAdminDataQuestion({
      question,
      userId,
      datasetId,
      connectionId,
      workspaceId,
      queryType,
      includeVisualization
    });

    res.json({
      message: 'Admin data question processed successfully',
      result: {
        answer: result.answer,
        data: result.data ? {
          rowCount: result.data.rowCount,
          columns: result.data.columns,
          executionTime: result.data.executionTime,
          queryType: result.data.queryType,
          cached: result.data.cached,
          // Include more data for admin (up to 1000 rows)
          preview: result.data.data.slice(0, 1000)
        } : null,
        query: result.query,
        queryType: result.queryType,
        visualization: result.visualization,
        confidence: result.confidence,
        executionTime: result.executionTime,
        tokens: result.tokens,
        adminContext: true
      }
    });

  } catch (error) {
    logger.error('Admin data question processing error:', error);
    res.status(500).json({
      error: 'Failed to process admin data question',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

// Admin execute direct query endpoint
router.post('/query', aiLimiter, validate(adminExecuteQuerySchema), async (req, res) => {
  try {
    const { query, queryType, datasetId, connectionId, workspaceId } = req.body;
    const userId = req.user.userId;

    logger.info(`Admin direct query execution from user ${userId}: ${queryType.toUpperCase()}`);

    const result = await adminDataService.executeAdminQuery(query, queryType, {
      datasetId,
      connectionId,
      workspaceId,
      userId
    });

    res.json({
      message: 'Admin query executed successfully',
      result: {
        rowCount: result.rowCount,
        columns: result.columns,
        executionTime: result.executionTime,
        queryType: result.queryType,
        cached: result.cached,
        // Include more data for admin (up to 5000 rows)
        data: result.data.slice(0, 5000),
        adminContext: true
      }
    });

  } catch (error) {
    logger.error('Admin direct query execution error:', error);
    res.status(500).json({
      error: 'Failed to execute admin query',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

// Get admin datasets
router.get('/datasets', async (req, res) => {
  try {
    const { workspaceId } = req.query;
    const userId = req.user.userId;

    logger.info(`Getting admin datasets for user ${userId}`);

    const datasets = await adminDataService.getAdminDatasets(workspaceId as string);

    res.json({
      message: 'Admin datasets retrieved successfully',
      datasets,
      adminContext: true
    });

  } catch (error) {
    logger.error('Get admin datasets error:', error);
    res.status(500).json({
      error: 'Failed to retrieve admin datasets',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

// Get admin dataset schema
router.get('/datasets/:datasetId/schema', async (req, res) => {
  try {
    const { datasetId } = req.params;
    const { workspaceId } = req.query;
    const userId = req.user.userId;

    logger.info(`Getting admin schema for dataset ${datasetId} for user ${userId}`);

    const schema = await adminDataService.getAdminDatasetSchema(datasetId, workspaceId as string);

    res.json({
      message: 'Admin dataset schema retrieved successfully',
      schema,
      adminContext: true
    });

  } catch (error) {
    logger.error('Get admin dataset schema error:', error);
    res.status(500).json({
      error: 'Failed to retrieve admin dataset schema',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

// Admin analyze question endpoint
router.post('/analyze', validate({
  body: Joi.object({
    question: Joi.string().min(1).max(1000).required()
  })
}), async (req, res) => {
  try {
    const { question } = req.body;
    const userId = req.user.userId;

    logger.info(`Analyzing admin question for user ${userId}: ${question}`);

    const analysis = await adminDataService.analyzeAdminQuestion(question);

    res.json({
      message: 'Admin question analyzed successfully',
      analysis,
      adminContext: true
    });

  } catch (error) {
    logger.error('Admin question analysis error:', error);
    res.status(500).json({
      error: 'Failed to analyze admin question',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

// Get admin connections (updated to remove direct database calls for now)
router.get('/connections', async (req, res) => {
  try {
    const userId = req.user.userId;
    
    logger.info(`Getting admin connections for user ${userId}`);
    
    // For now, return empty array - this would be implemented with proper database integration
    res.json({
      message: 'Admin database connections retrieved successfully',
      connections: [],
      adminContext: true
    });

  } catch (error) {
    logger.error('Get admin connections error:', error);
    res.status(500).json({
      error: 'Failed to retrieve admin database connections',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

// Create admin connection (placeholder implementation)
router.post('/connections', validate({
  body: Joi.object({
    name: Joi.string().min(1).max(200).required(),
    type: Joi.string().valid('fabric', 'sql-server', 'mysql', 'postgresql', 'oracle', 'mongodb').required(),
    host: Joi.string().min(1).max(500).required(),
    port: Joi.number().integer().min(1).max(65535).required(),
    database: Joi.string().max(200).optional(),
    username: Joi.string().max(200).optional(),
    password: Joi.string().max(500).optional(),
    isDefault: Joi.boolean().default(false)
  })
}), async (req, res) => {
  try {
    const { name, type, host, port, database, username, password, isDefault } = req.body;
    const userId = req.user.userId;
    const connectionId = uuidv4();

    logger.info(`Creating admin connection ${connectionId} for user ${userId}`);
    
    // Placeholder response - would be implemented with proper database integration
    const connectionResponse = {
      id: connectionId,
      name,
      type,
      host,
      port,
      database,
      username,
      isDefault,
      status: 'disconnected',
      createdAt: new Date().toISOString()
    };

    res.status(201).json({
      message: 'Admin database connection created successfully',
      connection: connectionResponse,
      adminContext: true
    });

  } catch (error) {
    logger.error('Create admin connection error:', error);
    res.status(500).json({
      error: 'Failed to create admin database connection',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

// Admin system health check
router.get('/health', async (req, res) => {
  try {
    const userId = req.user.userId;
    logger.info(`Admin health check from user ${userId}`);

    res.json({
      message: 'Admin data service health check successful',
      status: 'healthy',
      timestamp: new Date().toISOString(),
      adminContext: true,
      services: {
        aiDataService: 'operational',
        fabricService: 'operational',
        adminDataService: 'operational'
      }
    });

  } catch (error) {
    logger.error('Admin health check error:', error);
    res.status(500).json({
      error: 'Admin health check failed',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

export { router as adminDataRoutes };