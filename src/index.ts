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
import { StorageService } from './services/storage';
import { CacheService } from './services/cache';


// Load environment variables
dotenv.config({ path: '.env' });

// Debug: Check if environment variables are loaded
console.log('🔍 Environment Variables Check:');
console.log('AZURE_CLIENT_ID:', process.env.AZURE_CLIENT_ID ? 'SET' : 'MISSING');
console.log('AZURE_CLIENT_SECRET:', process.env.AZURE_CLIENT_SECRET ? 'SET' : 'MISSING');
console.log('AZURE_TENANT_ID:', process.env.AZURE_TENANT_ID ? 'SET' : 'MISSING');
console.log('SQL_SERVER:', process.env.SQL_SERVER ? 'SET' : 'MISSING');
console.log('SQL_DATABASE:', process.env.SQL_DATABASE ? 'SET' : 'MISSING');
console.log('SQL_USERNAME:', process.env.SQL_USERNAME ? 'SET' : 'MISSING');
console.log('SQL_PASSWORD:', process.env.SQL_PASSWORD ? 'SET' : 'MISSING');

export const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

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
    description: 'AI-powered chat application backend',
    endpoints: {
      auth: '/api/auth',
      chat: '/api/chat',
      user: '/api/user',
      files: '/api/files',
      workspaces: '/api/workspaces',
      search: '/api/search',
      feedback: '/api/feedback',
      keyVault: '/api/admin/keyvault'
    }
  });
});

// Simple test endpoint for mobile connectivity
app.get('/api/mobile-test', (req, res) => {
  res.json({
    status: 'success',
    message: 'Mobile app can reach the server!',
    timestamp: new Date().toISOString(),
    ip: req.ip,
    userAgent: req.get('User-Agent')
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
    // Initialize Azure services
    const { initializeAzureServices } = require('./services/azure');
    await initializeAzureServices();
    logger.info('✅ Azure services initialized');
    
    // Initialize ConfigurationManager to load settings from Key Vault
    const { ConfigurationManager } = require('./services/configurationManager');
    const configManager = ConfigurationManager.getInstance();
    await configManager.initialize();
    logger.info('✅ Configuration Manager initialized with Key Vault integration');
    
    // Note: Database initialization is handled by Azure services
    
    // Initialize storage
    const storageService = StorageService.getInstance();
    await storageService.initialize();
    await storageService.initializeContainer();
    logger.info('✅ Storage service ready');
    
    // Initialize cache
    const cacheService = CacheService.getInstance();
    await cacheService.initialize();
    logger.info('✅ Cache service ready');
    
    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`🚀 AIVA Backend API running on port ${PORT}`);
      logger.info(`📊 Health check: http://localhost:${PORT}/health`);
      logger.info(`📚 API info: http://localhost:${PORT}/api`);
      logger.info(`🌍 Environment: ${process.env.NODE_ENV}`);
      logger.info(`📱 Mobile access: http://0.0.0.0:${PORT}/api`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  // Cleanup services
  const dbManager = DatabaseManager.getInstance();
  dbManager.disconnect();
  
  const cacheService = CacheService.getInstance();
  cacheService.destroy();
  
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  
  // Cleanup services
  const dbManager = DatabaseManager.getInstance();
  dbManager.disconnect();
  
  const cacheService = CacheService.getInstance();
  cacheService.destroy();
  
  process.exit(0);
});

startServer();

