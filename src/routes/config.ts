import express from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth';
import { logger } from '../utils/logger';
import { DatabaseManager } from '../config/database';
import { StorageService } from '../services/storage';
import { OpenAIService } from '../services/openai';
import { ConfigurationManager } from '../services/configurationManager';

const router = express.Router();

// Apply authentication and admin check to all routes
router.use(authenticateToken);
router.use(requireAdmin);

// Get all configuration sections
router.get('/', async (req, res) => {
  try {
    const configManager = ConfigurationManager.getInstance();
    await configManager.initialize();
    
    const config = configManager.getAllConfigurations();

    res.json({
      message: 'Configuration retrieved successfully',
      config
    });
  } catch (error) {
    logger.error('Get configuration error:', error);
    res.status(500).json({ 
      error: 'Failed to retrieve configuration',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

// Update configuration for a specific section
router.put('/:section', async (req, res) => {
  try {
    const { section } = req.params;
    const configData = req.body;
    const adminEmail = req.user.email;

    logger.info(`Admin ${adminEmail} updating ${section} configuration`);

    // Validate section
    const validSections = ['database', 'openai', 'storage', 'identity', 'fabric', 'security'];
    if (!validSections.includes(section)) {
      return res.status(400).json({
        error: 'Invalid configuration section',
        message: `Section must be one of: ${validSections.join(', ')}`
      });
    }

    const configManager = ConfigurationManager.getInstance();
    await configManager.initialize();

    // Validate configuration
    const validation = await configManager.validateConfiguration(section);
    
    // Update configuration
    await configManager.updateConfiguration(section, configData, adminEmail);

    // Test the configuration if critical services
    if (['database', 'openai', 'storage'].includes(section)) {
      const testResult = await testServiceConnection(section);
      if (!testResult.success) {
        logger.warn(`Service test failed after configuration update: ${testResult.message}`);
      }
    }

    res.json({
      message: `${section} configuration updated successfully`,
      section,
      validation,
      updatedAt: new Date().toISOString(),
      updatedBy: adminEmail
    });

  } catch (error) {
    logger.error('Update configuration error:', error);
    res.status(500).json({
      error: 'Failed to update configuration',
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

// Test connection for a specific service
router.post('/:section/test', async (req, res) => {
  try {
    const { section } = req.params;
    const adminEmail = req.user.email;

    logger.info(`Admin ${adminEmail} testing ${section} connection`);

    const testResult = await testServiceConnection(section);

    res.json({
      message: `${section} connection test completed`,
      success: testResult.success,
      details: testResult.details,
      error: testResult.success ? null : testResult.message,
      testedAt: new Date().toISOString(),
      testedBy: adminEmail
    });

  } catch (error) {
    logger.error(`Test ${req.params.section} connection error:`, error);
    res.status(500).json({
      error: 'Connection test failed',
      message: error instanceof Error ? error.message : 'Unknown error occurred',
      success: false
    });
  }
});

// Helper function for testing connections
async function testServiceConnection(section: string) {
  let testResult = { success: false, message: '', details: {} };

  switch (section) {
    case 'database':
      testResult = await testDatabaseConnection();
      break;
    case 'openai':
      testResult = await testOpenAIConnection();
      break;
    case 'storage':
      testResult = await testStorageConnection();
      break;
    case 'identity':
      testResult = await testIdentityConnection();
      break;
    case 'fabric':
      testResult = await testFabricConnection();
      break;
    case 'security':
      testResult = await testSecurityConfig();
      break;
    default:
      return {
        success: false,
        message: 'Invalid service section',
        details: { error: 'Unknown service type' }
      };
  }

  return testResult;
}

// Helper functions for testing connections
async function testDatabaseConnection() {
  try {
    const dbManager = DatabaseManager.getInstance();
    const pool = await dbManager.getPool();
    const result = await pool.request().query('SELECT 1 as test');
    
    return {
      success: true,
      message: 'Database connection successful',
      details: {
        server: process.env.SQL_SERVER,
        database: process.env.SQL_DATABASE,
        connected: true,
        testQuery: result.recordset[0].test === 1
      }
    };
  } catch (error) {
    return {
      success: false,
      message: 'Database connection failed',
      details: { error: error instanceof Error ? error.message : 'Unknown error' }
    };
  }
}

async function testOpenAIConnection() {
  try {
    const openAIService = OpenAIService.getInstance();
    const result = await openAIService.getChatCompletion([
      { role: 'user', content: 'Test connection' }
    ], { maxTokens: 10 });
    
    return {
      success: true,
      message: 'OpenAI connection successful',
      details: {
        endpoint: process.env.AZURE_OPENAI_ENDPOINT,
        deployment: process.env.AZURE_OPENAI_DEPLOYMENT_NAME,
        connected: true,
        testTokens: result.tokens
      }
    };
  } catch (error) {
    return {
      success: false,
      message: 'OpenAI connection failed',
      details: { error: error instanceof Error ? error.message : 'Unknown error' }
    };
  }
}

async function testStorageConnection() {
  try {
    const storageService = StorageService.getInstance();
    await storageService.initializeContainer();
    
    return {
      success: true,
      message: 'Storage connection successful',
      details: {
        accountName: process.env.AZURE_STORAGE_ACCOUNT_NAME,
        containerName: process.env.AZURE_STORAGE_CONTAINER_NAME,
        connected: true
      }
    };
  } catch (error) {
    return {
      success: false,
      message: 'Storage connection failed',
      details: { error: error instanceof Error ? error.message : 'Unknown error' }
    };
  }
}

async function testIdentityConnection() {
  // For Azure AD, we can test by checking if credentials are configured
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  
  if (!tenantId || !clientId || !clientSecret) {
    return {
      success: false,
      message: 'Azure AD credentials not configured',
      details: { 
        tenantId: !!tenantId,
        clientId: !!clientId,
        clientSecret: !!clientSecret
      }
    };
  }

  // In production, you would make an actual test call to Azure AD
  return {
    success: true,
    message: 'Azure AD configuration appears valid',
    details: {
      tenantId: tenantId.substring(0, 8) + '...',
      clientId: clientId.substring(0, 8) + '...',
      configured: true
    }
  };
}

async function testFabricConnection() {
  const workspaceId = process.env.FABRIC_WORKSPACE_ID;
  
  if (!workspaceId) {
    return {
      success: false,
      message: 'Microsoft Fabric workspace not configured',
      details: { workspaceId: false }
    };
  }

  // In production, you would make an actual test call to Fabric API
  return {
    success: true,
    message: 'Microsoft Fabric configuration appears valid',
    details: {
      workspaceId: workspaceId.substring(0, 8) + '...',
      configured: true
    }
  };
}

async function testSecurityConfig() {
  const jwtSecret = process.env.JWT_SECRET;
  const adminEmails = process.env.ADMIN_EMAILS;
  
  return {
    success: !!jwtSecret,
    message: jwtSecret ? 'Security configuration is valid' : 'JWT secret is required',
    details: {
      jwtSecret: !!jwtSecret,
      adminEmails: !!adminEmails,
      configured: !!jwtSecret
    }
  };
}

export { router as configRoutes };