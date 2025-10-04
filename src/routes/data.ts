import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { validate, schemas } from '../middleware/validation';
import { aiLimiter } from '../middleware/rateLimiter';
import { AIDataService } from '../services/aiDataService';
import { FabricDataAgentService } from '../services/fabricDataAgent';
import { logger } from '../utils/logger';
import Joi from 'joi';
import { DatabaseManager } from '../config/database';
import sql from 'mssql';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

// Apply authentication to all data routes
router.use(authenticateToken);

const aiDataService = AIDataService.getInstance();
const fabricService = FabricDataAgentService.getInstance();
const dbManager = DatabaseManager.getInstance();

// Validation schemas for data routes
const dataQuestionSchema = {
  body: Joi.object({
    question: Joi.string().min(1).max(1000).required(),
    datasetId: Joi.string().uuid().optional(),
    connectionId: Joi.string().uuid().optional(),
    workspaceId: Joi.string().uuid().optional(),
    queryType: Joi.string().valid('dax', 'sql').optional(),
    includeVisualization: Joi.boolean().default(true)
  })
};

const executeQuerySchema = {
  body: Joi.object({
    query: Joi.string().min(1).max(10000).required(),
    queryType: Joi.string().valid('dax', 'sql').required(),
    datasetId: Joi.string().uuid().optional(),
    connectionId: Joi.string().uuid().optional(),
    workspaceId: Joi.string().uuid().optional()
  })
};

// Ask data question endpoint
router.post('/question', aiLimiter, validate(dataQuestionSchema), async (req, res) => {
  try {
    const { question, datasetId, connectionId, workspaceId, queryType, includeVisualization } = req.body;
    const userId = req.user.userId;

    logger.info(`Data question from user ${userId}: ${question}`);

    const result = await aiDataService.processDataQuestion({
      question,
      userId,
      datasetId,
      connectionId,
      workspaceId,
      queryType,
      includeVisualization
    });

    res.json({
      message: 'Data question processed successfully',
      result: {
        answer: result.answer,
        data: result.data ? {
          rowCount: result.data.rowCount,
          columns: result.data.columns,
          executionTime: result.data.executionTime,
          queryType: result.data.queryType,
          cached: result.data.cached,
          // Only include first 100 rows for response size
          preview: result.data.data.slice(0, 100)
        } : null,
        query: result.query,
        queryType: result.queryType,
        visualization: result.visualization,
        confidence: result.confidence,
        executionTime: result.executionTime,
        tokens: result.tokens
      }
    });

  } catch (error) {
    logger.error('Data question processing error:', error);
    res.status(500).json({
      error: 'Failed to process data question',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

// Execute direct query endpoint
router.post('/query', aiLimiter, validate(executeQuerySchema), async (req, res) => {
  try {
    const { query, queryType, datasetId, connectionId, workspaceId } = req.body;
    const userId = req.user.userId;

    logger.info(`Direct query execution from user ${userId}: ${queryType.toUpperCase()}`);

    let result;
    if (queryType === 'dax') {
      if (!datasetId) {
        return res.status(400).json({
          error: 'Dataset ID required for DAX queries'
        });
      }
      result = await fabricService.executeDaxQuery(datasetId, query, workspaceId);
    } else {
      result = await fabricService.executeSqlQuery(query, workspaceId, connectionId);
    }

    res.json({
      message: 'Query executed successfully',
      result: {
        rowCount: result.rowCount,
        columns: result.columns,
        executionTime: result.executionTime,
        queryType: result.queryType,
        cached: result.cached,
        // Only include first 1000 rows for direct queries
        data: result.data.slice(0, 1000)
      }
    });

  } catch (error) {
    logger.error('Direct query execution error:', error);
    res.status(500).json({
      error: 'Failed to execute query',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

// Get available datasets
router.get('/datasets', async (req, res) => {
  try {
    const { workspaceId } = req.query;
    const userId = req.user.userId;

    logger.info(`Getting datasets for user ${userId}`);

    const datasets = await aiDataService.getAvailableDatasets(workspaceId as string);

    res.json({
      message: 'Datasets retrieved successfully',
      datasets
    });

  } catch (error) {
    logger.error('Get datasets error:', error);
    res.status(500).json({
      error: 'Failed to retrieve datasets',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

// Get dataset schema
router.get('/datasets/:datasetId/schema', async (req, res) => {
  try {
    const { datasetId } = req.params;
    const { workspaceId } = req.query;
    const userId = req.user.userId;

    logger.info(`Getting schema for dataset ${datasetId} for user ${userId}`);

    const schema = await aiDataService.getDatasetSchema(datasetId, workspaceId as string);

    res.json({
      message: 'Dataset schema retrieved successfully',
      schema
    });

  } catch (error) {
    logger.error('Get dataset schema error:', error);
    res.status(500).json({
      error: 'Failed to retrieve dataset schema',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

// Analyze question endpoint (for query suggestions)
router.post('/analyze', validate({
  body: Joi.object({
    question: Joi.string().min(1).max(1000).required()
  })
}), async (req, res) => {
  try {
    const { question } = req.body;
    const userId = req.user.userId;

    logger.info(`Analyzing question for user ${userId}: ${question}`);

    const analysis = await fabricService.analyzeQuestion(question);

    res.json({
      message: 'Question analyzed successfully',
      analysis
    });

  } catch (error) {
    logger.error('Question analysis error:', error);
    res.status(500).json({
      error: 'Failed to analyze question',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

// Get query suggestions based on dataset
router.get('/datasets/:datasetId/suggestions', async (req, res) => {
  try {
    const { datasetId } = req.params;
    const { workspaceId } = req.query;
    const userId = req.user.userId;

    logger.info(`Getting query suggestions for dataset ${datasetId} for user ${userId}`);

    // Get dataset schema to generate suggestions
    const schema = await aiDataService.getDatasetSchema(datasetId, workspaceId as string);
    
    // Generate common query suggestions based on schema
    const suggestions = generateQuerySuggestions(schema);

    res.json({
      message: 'Query suggestions generated successfully',
      suggestions
    });

  } catch (error) {
    logger.error('Get query suggestions error:', error);
    res.status(500).json({
      error: 'Failed to generate query suggestions',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

// Get database connections
router.get('/connections', async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const pool = await dbManager.getPool();
    const result = await pool.request()
      .input('userId', sql.NVarChar, userId)
      .query(`
        SELECT 
          id, name, type, host, port, database, username, 
          status, lastConnected, isDefault, createdAt
        FROM DatabaseConnections 
        WHERE userId = @userId 
        ORDER BY isDefault DESC, name ASC
      `);

    res.json({
      message: 'Database connections retrieved successfully',
      connections: result.recordset
    });

  } catch (error) {
    logger.error('Get connections error:', error);
    res.status(500).json({
      error: 'Failed to retrieve database connections',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

// Create database connection
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

    const pool = await dbManager.getPool();
    
    // If this is set as default, unset other defaults
    if (isDefault) {
      await pool.request()
        .input('userId', sql.NVarChar, userId)
        .query(`
          UPDATE DatabaseConnections 
          SET isDefault = 0 
          WHERE userId = @userId
        `);
    }

    const result = await pool.request()
      .input('id', sql.NVarChar, connectionId)
      .input('userId', sql.NVarChar, userId)
      .input('name', sql.NVarChar, name)
      .input('type', sql.NVarChar, type)
      .input('host', sql.NVarChar, host)
      .input('port', sql.Int, port)
      .input('database', sql.NVarChar, database || null)
      .input('username', sql.NVarChar, username || null)
      .input('password', sql.NVarChar, password || null) // In production, encrypt this
      .input('isDefault', sql.Bit, isDefault)
      .query(`
        INSERT INTO DatabaseConnections 
        (id, userId, name, type, host, port, database, username, password, isDefault, status)
        OUTPUT INSERTED.*
        VALUES (@id, @userId, @name, @type, @host, @port, @database, @username, @password, @isDefault, 'disconnected')
      `);

    const connection = result.recordset[0];
    
    // Remove password from response
    const { password: _, ...connectionResponse } = connection;

    res.status(201).json({
      message: 'Database connection created successfully',
      connection: connectionResponse
    });

    logger.info(`Database connection created: ${connectionId} for user: ${userId}`);
  } catch (error) {
    logger.error('Create connection error:', error);
    res.status(500).json({
      error: 'Failed to create database connection',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

// Test database connection
router.post('/connections/:connectionId/test', async (req, res) => {
  try {
    const { connectionId } = req.params;
    const userId = req.user.userId;

    const pool = await dbManager.getPool();
    
    // Get connection details
    const connectionResult = await pool.request()
      .input('connectionId', sql.NVarChar, connectionId)
      .input('userId', sql.NVarChar, userId)
      .query(`
        SELECT * FROM DatabaseConnections 
        WHERE id = @connectionId AND userId = @userId
      `);

    if (connectionResult.recordset.length === 0) {
      return res.status(404).json({
        error: 'Connection not found'
      });
    }

    const connection = connectionResult.recordset[0];
    
    // Test the connection (implement actual connection testing based on type)
    let status = 'connected';
    let errorMessage = null;
    
    try {
      // This would contain actual connection testing logic for each database type
      // For now, simulate a successful test
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      status = 'error';
      errorMessage = error instanceof Error ? error.message : 'Connection failed';
    }

    // Update connection status
    await pool.request()
      .input('connectionId', sql.NVarChar, connectionId)
      .input('status', sql.NVarChar, status)
      .input('lastConnected', sql.DateTime2, status === 'connected' ? new Date() : null)
      .query(`
        UPDATE DatabaseConnections 
        SET status = @status, lastConnected = @lastConnected, updatedAt = GETUTCDATE()
        WHERE id = @connectionId
      `);

    res.json({
      message: status === 'connected' ? 'Connection test successful' : 'Connection test failed',
      status,
      error: errorMessage
    });

    logger.info(`Connection test for ${connectionId}: ${status}`);
  } catch (error) {
    logger.error('Test connection error:', error);
    res.status(500).json({
      error: 'Failed to test database connection',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

// Delete database connection
router.delete('/connections/:connectionId', async (req, res) => {
  try {
    const { connectionId } = req.params;
    const userId = req.user.userId;

    const pool = await dbManager.getPool();
    
    const result = await pool.request()
      .input('connectionId', sql.NVarChar, connectionId)
      .input('userId', sql.NVarChar, userId)
      .query(`
        DELETE FROM DatabaseConnections 
        WHERE id = @connectionId AND userId = @userId
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({
        error: 'Connection not found'
      });
    }

    res.json({
      message: 'Database connection deleted successfully'
    });

    logger.info(`Database connection deleted: ${connectionId} by user: ${userId}`);
  } catch (error) {
    logger.error('Delete connection error:', error);
    res.status(500).json({
      error: 'Failed to delete database connection',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

// Helper function to generate query suggestions
function generateQuerySuggestions(schema: any): string[] {
  const suggestions: string[] = [];
  
  if (schema?.tables) {
    schema.tables.forEach((table: any) => {
      const tableName = table.name;
      
      // Basic suggestions
      suggestions.push(`Show me the top 10 records from ${tableName}`);
      suggestions.push(`What is the total count of records in ${tableName}?`);
      
      // Suggestions based on columns
      if (table.columns) {
        const numericColumns = table.columns.filter((col: any) => 
          col.dataType === 'Int64' || col.dataType === 'Double' || col.dataType === 'Decimal'
        );
        
        const dateColumns = table.columns.filter((col: any) => 
          col.dataType === 'DateTime'
        );
        
        numericColumns.forEach((col: any) => {
          suggestions.push(`What is the average ${col.name} in ${tableName}?`);
          suggestions.push(`Show me the sum of ${col.name} by month`);
        });
        
        if (dateColumns.length > 0) {
          suggestions.push(`Show me trends over time for ${tableName}`);
          suggestions.push(`What was the performance last month?`);
        }
      }
    });
  }
  
  // Limit to 10 suggestions
  return suggestions.slice(0, 10);
}

export { router as dataRoutes };