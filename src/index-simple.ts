import express from 'express';
import cors from 'cors';
import compression from 'compression';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { requestSizeLimiter, corsOptions } from './middleware/security';
import { generalLimiter } from './middleware/rateLimiter';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';
import { authRoutes } from './routes/auth';
import { chatRoutes } from './routes/chat';
import { userRoutes } from './routes/user';
import { dataRoutes } from './routes/data';
import { fileRoutes } from './routes/files';
import { workspaceRoutes } from './routes/workspace';
import { searchRoutes } from './routes/search';
import { adminRoutes } from './routes/admin';
import { feedbackRoutes } from './routes/feedback';
import { adminDataRoutes } from './routes/adminData';
import { configRoutes } from './routes/config';
import { bookmarkRoutes } from './routes/bookmarks';
import { messageActionRoutes } from './routes/messageActions';
import { historyRoutes } from './routes/history';
import { DatabaseManager } from './config/database';

// Load environment variables
dotenv.config();

export const app = express();
const PORT = process.env.PORT || 3000;

app.use(requestSizeLimiter);
app.use(compression());

// Rate limiting
app.use(generalLimiter);

// CORS configuration
app.use(cors(corsOptions));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'AIVA Backend API',
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    name: 'AIVA Backend API',
    version: process.env.npm_package_version || '1.0.0',
    description: 'AI-powered chat application backend with Azure SQL database',
    endpoints: {
      auth: '/api/auth',
      chat: '/api/chat',
      user: '/api/user',
      files: '/api/files',
      workspaces: '/api/workspaces',
      search: '/api/search',
      feedback: '/api/feedback',
      history: '/api/history',
      bookmarks: '/api/bookmarks',
      'message-actions': '/api/message-actions'
    }
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/user', userRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/admin/data', adminDataRoutes);
app.use('/api/admin/config', configRoutes);
app.use('/api/bookmarks', bookmarkRoutes);
app.use('/api/message-actions', messageActionRoutes);
app.use('/api/history', historyRoutes);

// Error handling middleware
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    message: `Cannot ${req.method} ${req.originalUrl}`
  });
});

// Initialize services and start server
async function startServer() {
  try {
    logger.info('🔄 Starting AIVA Backend with Azure SQL Database...');
    
    // Initialize Azure SQL Database only
    const { initializeAzureServices } = require('./services/azure');
    await initializeAzureServices();
    logger.info('✅ Azure SQL Database initialized');
    
    // Test database connection
    const dbManager = DatabaseManager.getInstance();
    await dbManager.connect();
    logger.info('✅ Database connection verified');
    
    app.listen(PORT, () => {
      logger.info(`🚀 AIVA Backend API running on port ${PORT}`);
      logger.info(`📊 Health check: http://localhost:${PORT}/health`);
      logger.info(`📚 API info: http://localhost:${PORT}/api`);
      logger.info(`💾 Azure SQL Database: Connected and Ready`);
      logger.info(`🌍 Environment: ${process.env.NODE_ENV}`);
      logger.info(`🔗 Frontend should connect to: http://localhost:${PORT}`);
    });
  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    logger.error('Make sure Azure SQL Database credentials are correct in .env file');
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  // Cleanup services
  const dbManager = DatabaseManager.getInstance();
  dbManager.disconnect();
  
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  
  // Cleanup services
  const dbManager = DatabaseManager.getInstance();
  dbManager.disconnect();
  
  process.exit(0);
});

startServer();