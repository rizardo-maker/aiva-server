import express from 'express';
import { authenticateToken, requireAdmin } from '../middleware/auth';
import { ConfigurationManager } from '../services/configurationManager';
import { KeyVaultService } from '../services/keyVaultService';
import { logger } from '../utils/logger';

const router = express.Router();

// Get Key Vault status and configuration
router.get('/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const configManager = ConfigurationManager.getInstance();
    const keyVaultService = KeyVaultService.getInstance();

    const status = {
      enabled: configManager.isKeyVaultEnabled(),
      initialized: keyVaultService.isInitialized(),
      keyVaultUrl: configManager.getKeyVaultUrl(),
      timestamp: new Date().toISOString()
    };

    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    logger.error('Error getting Key Vault status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get Key Vault status'
    });
  }
});

// List secrets in Key Vault (names only, not values)
router.get('/secrets', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const configManager = ConfigurationManager.getInstance();
    
    if (!configManager.isKeyVaultEnabled()) {
      return res.status(400).json({
        success: false,
        error: 'Key Vault is not enabled'
      });
    }

    const keyVaultService = configManager.getKeyVaultService();
    const secretNames = await keyVaultService.listSecrets();

    res.json({
      success: true,
      data: {
        count: secretNames.length,
        secrets: secretNames
      }
    });
  } catch (error) {
    logger.error('Error listing Key Vault secrets:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list Key Vault secrets'
    });
  }
});

// Check if a specific secret exists
router.get('/secrets/:secretName/exists', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { secretName } = req.params;
    const configManager = ConfigurationManager.getInstance();
    
    if (!configManager.isKeyVaultEnabled()) {
      return res.status(400).json({
        success: false,
        error: 'Key Vault is not enabled'
      });
    }

    const keyVaultService = configManager.getKeyVaultService();
    const exists = await keyVaultService.secretExists(secretName);

    res.json({
      success: true,
      data: {
        secretName,
        exists
      }
    });
  } catch (error) {
    logger.error(`Error checking if secret '${req.params.secretName}' exists:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to check secret existence'
    });
  }
});

// Store a secret in Key Vault
router.post('/secrets', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { secretName, secretValue, contentType } = req.body;
    
    if (!secretName || !secretValue) {
      return res.status(400).json({
        success: false,
        error: 'Secret name and value are required'
      });
    }

    const configManager = ConfigurationManager.getInstance();
    
    if (!configManager.isKeyVaultEnabled()) {
      return res.status(400).json({
        success: false,
        error: 'Key Vault is not enabled'
      });
    }

    const keyVaultService = configManager.getKeyVaultService();
    await keyVaultService.setSecret(secretName, secretValue, contentType);

    // Log the action
    logger.info(`Admin ${req.user?.email} stored secret '${secretName}' in Key Vault`);

    res.json({
      success: true,
      message: `Secret '${secretName}' stored successfully in Key Vault`
    });
  } catch (error) {
    logger.error('Error storing secret in Key Vault:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to store secret in Key Vault'
    });
  }
});

// Update a secret in Key Vault
router.put('/secrets/:secretName', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { secretName } = req.params;
    const { secretValue, contentType } = req.body;
    
    if (!secretValue) {
      return res.status(400).json({
        success: false,
        error: 'Secret value is required'
      });
    }

    const configManager = ConfigurationManager.getInstance();
    
    if (!configManager.isKeyVaultEnabled()) {
      return res.status(400).json({
        success: false,
        error: 'Key Vault is not enabled'
      });
    }

    const keyVaultService = configManager.getKeyVaultService();
    await keyVaultService.updateSecret(secretName, secretValue);

    // Log the action
    logger.info(`Admin ${req.user?.email} updated secret '${secretName}' in Key Vault`);

    res.json({
      success: true,
      message: `Secret '${secretName}' updated successfully in Key Vault`
    });
  } catch (error) {
    logger.error(`Error updating secret '${req.params.secretName}' in Key Vault:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to update secret in Key Vault'
    });
  }
});

// Delete a secret from Key Vault
router.delete('/secrets/:secretName', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { secretName } = req.params;
    const configManager = ConfigurationManager.getInstance();
    
    if (!configManager.isKeyVaultEnabled()) {
      return res.status(400).json({
        success: false,
        error: 'Key Vault is not enabled'
      });
    }

    const keyVaultService = configManager.getKeyVaultService();
    await keyVaultService.deleteSecret(secretName);

    // Log the action
    logger.info(`Admin ${req.user?.email} deleted secret '${secretName}' from Key Vault`);

    res.json({
      success: true,
      message: `Secret '${secretName}' deleted successfully from Key Vault`
    });
  } catch (error) {
    logger.error(`Error deleting secret '${req.params.secretName}' from Key Vault:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete secret from Key Vault'
    });
  }
});

// Migrate secrets from database to Key Vault
router.post('/migrate', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const configManager = ConfigurationManager.getInstance();
    
    if (!configManager.isKeyVaultEnabled()) {
      return res.status(400).json({
        success: false,
        error: 'Key Vault is not enabled'
      });
    }

    await configManager.migrateSecretsToKeyVault();

    // Log the action
    logger.info(`Admin ${req.user?.email} initiated secret migration to Key Vault`);

    res.json({
      success: true,
      message: 'Secrets migration to Key Vault completed successfully'
    });
  } catch (error) {
    logger.error('Error migrating secrets to Key Vault:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to migrate secrets to Key Vault'
    });
  }
});

// Initialize Key Vault with custom configuration
router.post('/initialize', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { keyVaultUrl, tenantId, clientId, clientSecret } = req.body;
    
    if (!keyVaultUrl) {
      return res.status(400).json({
        success: false,
        error: 'Key Vault URL is required'
      });
    }

    const keyVaultService = KeyVaultService.getInstance();
    await keyVaultService.initialize({
      keyVaultUrl,
      tenantId,
      clientId,
      clientSecret
    });

    // Log the action
    logger.info(`Admin ${req.user?.email} initialized Key Vault with URL: ${keyVaultUrl}`);

    res.json({
      success: true,
      message: 'Key Vault initialized successfully'
    });
  } catch (error) {
    logger.error('Error initializing Key Vault:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initialize Key Vault'
    });
  }
});

export { router as keyVaultRoutes };