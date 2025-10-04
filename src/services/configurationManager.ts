import { DatabaseManager } from '../config/database';
import { logger } from '../utils/logger';
import { OpenAIService } from './openai';
import { StorageService } from './storage';
import { KeyVaultService } from './keyVaultService';
import { v4 as uuidv4 } from 'uuid';

export interface ConfigurationSection {
  section: string;
  key: string;
  value: string;
  encrypted: boolean;
  updatedAt: Date;
  updatedBy: string;
}

export class ConfigurationManager {
  private static instance: ConfigurationManager;
  private configurations: Map<string, string> = new Map();
  private keyVaultService: KeyVaultService;
  private initialized = false;
  private useKeyVault = false;

  private constructor() {
    this.keyVaultService = KeyVaultService.getInstance();
  }

  public static getInstance(): ConfigurationManager {
    if (!ConfigurationManager.instance) {
      ConfigurationManager.instance = new ConfigurationManager();
    }
    return ConfigurationManager.instance;
  }

  public async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // First try to initialize Key Vault if configured
      await this.tryInitializeKeyVault();
      
      // Then load configurations from database
      await this.loadConfigurationsFromDatabase();
      this.initialized = true;
      logger.info('✅ Configuration Manager initialized');
    } catch (error) {
      logger.warn('Failed to load configurations from database, using environment variables:', error);
      this.loadConfigurationsFromEnv();
      this.initialized = true;
    }
  }

  private async loadConfigurationsFromDatabase(): Promise<void> {
    try {
      const dbManager = DatabaseManager.getInstance();
      const pool = await dbManager.getPool();
      
      // Create configurations table if it doesn't exist
      await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='system_configurations' AND xtype='U')
        CREATE TABLE system_configurations (
          id INT IDENTITY(1,1) PRIMARY KEY,
          section NVARCHAR(50) NOT NULL,
          config_key NVARCHAR(100) NOT NULL,
          config_value NVARCHAR(MAX) NOT NULL,
          encrypted BIT DEFAULT 0,
          updated_at DATETIME2 DEFAULT GETDATE(),
          updated_by NVARCHAR(255),
          UNIQUE(section, config_key)
        )
      `);

      const result = await pool.request().query(`
        SELECT section, config_key, config_value, encrypted 
        FROM system_configurations
      `);

      // Load configurations into memory
      for (const row of result.recordset) {
        const key = `${row.section}.${row.config_key}`;
        let value = row.config_value;
        
        // Try to get from Key Vault first, then decrypt from database
        if (row.encrypted) {
          if (this.useKeyVault) {
            try {
              const keyVaultValue = await this.keyVaultService.getSecret(key);
              if (keyVaultValue) {
                value = keyVaultValue;
                logger.debug(`Retrieved encrypted config '${key}' from Key Vault`);
              } else {
                // Fallback to database decryption
                value = Buffer.from(value, 'base64').toString('utf-8');
                logger.debug(`Fallback: decrypted config '${key}' from database`);
              }
            } catch (error) {
              logger.warn(`Failed to retrieve '${key}' from Key Vault, using database:`, error);
              value = Buffer.from(value, 'base64').toString('utf-8');
            }
          } else {
            // Fallback to simple base64 decoding
            try {
              value = Buffer.from(value, 'base64').toString('utf-8');
            } catch (error) {
              logger.warn(`Failed to decrypt configuration ${key}`);
            }
          }
        }
        
        this.configurations.set(key, value);
        // Also set as environment variable for compatibility
        process.env[row.config_key] = value;
      }

      logger.info(`Loaded ${this.configurations.size} configurations from database`);
    } catch (error) {
      logger.error('Failed to load configurations from database:', error);
      throw error;
    }
  }

  private loadConfigurationsFromEnv(): void {
    // Load current environment variables into our configuration map
    const envVars = [
      'SQL_SERVER', 'SQL_DATABASE', 'SQL_USERNAME', 'SQL_PASSWORD',
      'SQL_ENCRYPT', 'SQL_TRUST_SERVER_CERTIFICATE', 'SQL_POOL_MAX', 'SQL_POOL_MIN',
      'SQL_REQUEST_TIMEOUT', 'SQL_CONNECTION_TIMEOUT',
      'AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_DEPLOYMENT_NAME',
      'AZURE_STORAGE_ACCOUNT_NAME', 'AZURE_STORAGE_CONNECTION_STRING', 'AZURE_STORAGE_CONTAINER_NAME',
      'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET',
      'FABRIC_WORKSPACE_ID', 'FABRIC_CAPACITY_ID', 'FABRIC_DATASET_ID',
      'JWT_SECRET', 'ADMIN_EMAILS', 'SESSION_TIMEOUT'
    ];

    const sectionMap: Record<string, string> = {
      'SQL_': 'database',
      'AZURE_OPENAI_': 'openai',
      'AZURE_STORAGE_': 'storage',
      'AZURE_TENANT_': 'identity',
      'AZURE_CLIENT_': 'identity',
      'FABRIC_': 'fabric',
      'JWT_': 'security',
      'ADMIN_': 'security',
      'SESSION_': 'security'
    };

    for (const envVar of envVars) {
      if (process.env[envVar]) {
        const section = this.getSectionForEnvVar(envVar, sectionMap);
        const key = `${section}.${envVar}`;
        this.configurations.set(key, process.env[envVar]!);
      }
    }

    logger.info(`Loaded ${this.configurations.size} configurations from environment`);
  }

  private getSectionForEnvVar(envVar: string, sectionMap: Record<string, string>): string {
    for (const [prefix, section] of Object.entries(sectionMap)) {
      if (envVar.startsWith(prefix)) {
        return section;
      }
    }
    return 'general';
  }

  public async updateConfiguration(
    section: string, 
    configData: Record<string, string>, 
    updatedBy: string
  ): Promise<void> {
    await this.initialize();

    try {
      const dbManager = DatabaseManager.getInstance();
      const pool = await dbManager.getPool();

      for (const [key, value] of Object.entries(configData)) {
        // Don't update masked passwords
        if (value.includes('••••')) {
          continue;
        }

        const isPassword = key.toLowerCase().includes('password') || 
                          key.toLowerCase().includes('secret') || 
                          key.toLowerCase().includes('key');
        
        let storedValue = value;
        
        // Store sensitive values in Key Vault if available
        if (isPassword && value && this.useKeyVault) {
          try {
            const configKey = `${section}.${key}`;
            await this.keyVaultService.setSecret(configKey, value);
            logger.info(`✅ Stored sensitive config '${configKey}' in Key Vault`);
            // Store a reference marker in database
            storedValue = `__KEY_VAULT__:${configKey}`;
          } catch (error) {
            logger.warn(`Failed to store '${key}' in Key Vault, using database encryption:`, error);
            // Fallback to base64 encoding
            storedValue = Buffer.from(value, 'utf-8').toString('base64');
          }
        } else if (isPassword && value) {
          // Fallback to simple base64 encoding
          storedValue = Buffer.from(value, 'utf-8').toString('base64');
        }

        // Update or insert configuration
        await pool.request()
          .input('section', section)
          .input('key', key)
          .input('value', storedValue)
          .input('encrypted', isPassword)
          .input('updatedBy', updatedBy)
          .query(`
            MERGE system_configurations AS target
            USING (SELECT @section as section, @key as config_key, @value as config_value, 
                          @encrypted as encrypted, @updatedBy as updated_by) AS source
            ON target.section = source.section AND target.config_key = source.config_key
            WHEN MATCHED THEN
              UPDATE SET config_value = source.config_value, 
                        encrypted = source.encrypted,
                        updated_at = GETDATE(),
                        updated_by = source.updated_by
            WHEN NOT MATCHED THEN
              INSERT (section, config_key, config_value, encrypted, updated_by)
              VALUES (source.section, source.config_key, source.config_value, 
                     source.encrypted, source.updated_by);
          `);

        // Update in-memory configuration
        const configKey = `${section}.${key}`;
        this.configurations.set(configKey, value);
        
        // Update environment variable
        process.env[key] = value;
      }

      // Reinitialize services with new configuration
      await this.reinitializeServices(section);

      logger.info(`Configuration updated for section: ${section} by ${updatedBy}`);
    } catch (error) {
      logger.error('Failed to update configuration:', error);
      throw error;
    }
  }

  public getConfiguration(section: string): Record<string, string> {
    const result: Record<string, string> = {};
    const prefix = `${section}.`;
    
    for (const [key, value] of this.configurations.entries()) {
      if (key.startsWith(prefix)) {
        const configKey = key.substring(prefix.length);
        // Mask sensitive values
        if (this.isSensitiveKey(configKey)) {
          result[configKey] = this.maskSensitiveValue(value);
        } else {
          result[configKey] = value;
        }
      }
    }

    return result;
  }

  public getAllConfigurations(): Record<string, Record<string, string>> {
    const sections = ['database', 'openai', 'storage', 'identity', 'fabric', 'security'];
    const result: Record<string, Record<string, string>> = {};
    
    for (const section of sections) {
      result[section] = this.getConfiguration(section);
    }
    
    return result;
  }

  private isSensitiveKey(key: string): boolean {
    const sensitiveKeys = ['password', 'secret', 'key', 'connection_string'];
    return sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive));
  }

  private maskSensitiveValue(value: string): string {
    if (!value) return '';
    if (value.length <= 4) return '••••';
    return '••••••••••••••••••••••••••••••••';
  }

  private async reinitializeServices(section: string): Promise<void> {
    try {
      switch (section) {
        case 'openai':
          // Reset and reconfigure OpenAI service
          OpenAIService.resetInstance();
          OpenAIService.getInstance();
          break;
        
        case 'storage':
          // Reset and reconfigure Storage service
          StorageService.resetInstance();
          const storageService = StorageService.getInstance();
          await storageService.initializeContainer();
          break;
        
        case 'database':
          // Reinitialize database connection
          const dbManager = DatabaseManager.getInstance();
          await dbManager.reinitialize();
          break;
        
        default:
          logger.info(`No service reinitialization needed for section: ${section}`);
      }
    } catch (error) {
      logger.warn(`Failed to reinitialize services for section ${section}:`, error);
    }
  }

  private async tryInitializeKeyVault(): Promise<void> {
    try {
      // Check if Key Vault is disabled
      if (process.env.DISABLE_KEY_VAULT === 'true') {
        logger.info('🔧 Key Vault disabled by DISABLE_KEY_VAULT environment variable');
        this.useKeyVault = false;
        return;
      }

      const keyVaultUrl = process.env.AZURE_KEY_VAULT_URL || process.env.KEY_VAULT_URL;
      
      if (keyVaultUrl) {
        await this.keyVaultService.initialize();
        this.useKeyVault = true;
        logger.info('✅ Key Vault integration enabled');
      } else {
        logger.info('⚠️ Key Vault URL not configured, using database encryption');
        this.useKeyVault = false;
      }
    } catch (error) {
      logger.warn('Failed to initialize Key Vault, falling back to database encryption:', error);
      this.useKeyVault = false;
    }
  }

  public async migrateSecretsToKeyVault(): Promise<void> {
    if (!this.useKeyVault) {
      throw new Error('Key Vault is not configured');
    }

    try {
      const dbManager = DatabaseManager.getInstance();
      const pool = await dbManager.getPool();

      // Get all encrypted configurations from database
      const result = await pool.request().query(`
        SELECT section, config_key, config_value 
        FROM system_configurations 
        WHERE encrypted = 1
      `);

      const migratedSecrets: string[] = [];

      for (const row of result.recordset) {
        try {
          const key = `${row.section}.${row.config_key}`;
          
          // Skip if already migrated
          if (row.config_value.startsWith('__KEY_VAULT__:')) {
            continue;
          }

          // Decrypt from database
          const decryptedValue = Buffer.from(row.config_value, 'base64').toString('utf-8');
          
          // Store in Key Vault
          await this.keyVaultService.setSecret(key, decryptedValue);
          
          // Update database with reference
          await pool.request()
            .input('section', row.section)
            .input('key', row.config_key)
            .input('value', `__KEY_VAULT__:${key}`)
            .query(`
              UPDATE system_configurations 
              SET config_value = @value, updated_at = GETDATE()
              WHERE section = @section AND config_key = @key
            `);

          migratedSecrets.push(key);
          logger.info(`✅ Migrated secret '${key}' to Key Vault`);
        } catch (error) {
          logger.error(`Failed to migrate secret '${row.section}.${row.config_key}':`, error);
        }
      }

      logger.info(`✅ Migration completed. ${migratedSecrets.length} secrets migrated to Key Vault`);
    } catch (error) {
      logger.error('Failed to migrate secrets to Key Vault:', error);
      throw error;
    }
  }

  public async validateConfiguration(section: string): Promise<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  }> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const config = this.getConfiguration(section);

    switch (section) {
      case 'database':
        if (!config.SQL_SERVER) errors.push('SQL Server is required');
        if (!config.SQL_DATABASE) errors.push('Database name is required');
        if (!config.SQL_USERNAME) errors.push('Username is required');
        if (!config.SQL_PASSWORD || config.SQL_PASSWORD.includes('••••')) {
          errors.push('Password is required');
        }
        break;

      case 'openai':
        if (!config.AZURE_OPENAI_ENDPOINT) errors.push('OpenAI endpoint is required');
        if (!config.AZURE_OPENAI_API_KEY || config.AZURE_OPENAI_API_KEY.includes('••••')) {
          errors.push('OpenAI API key is required');
        }
        if (!config.AZURE_OPENAI_DEPLOYMENT_NAME) {
          warnings.push('Deployment name not set, using default: gpt-4');
        }
        break;

      case 'storage':
        if (!config.AZURE_STORAGE_ACCOUNT_NAME) errors.push('Storage account name is required');
        if (!config.AZURE_STORAGE_CONNECTION_STRING || config.AZURE_STORAGE_CONNECTION_STRING.includes('••••')) {
          warnings.push('Connection string not set, will use managed identity');
        }
        break;

      case 'identity':
        if (!config.AZURE_TENANT_ID) errors.push('Azure tenant ID is required');
        if (!config.AZURE_CLIENT_ID) errors.push('Azure client ID is required');
        if (!config.AZURE_CLIENT_SECRET || config.AZURE_CLIENT_SECRET.includes('••••')) {
          errors.push('Azure client secret is required');
        }
        break;

      case 'security':
        if (!config.JWT_SECRET || config.JWT_SECRET.includes('••••')) {
          errors.push('JWT secret is required');
        }
        break;
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  public isKeyVaultEnabled(): boolean {
    return this.useKeyVault;
  }

  public getKeyVaultUrl(): string {
    return this.keyVaultService.getKeyVaultUrl();
  }

  /**
   * Directly retrieve a secret from Key Vault (bypassing cache)
   */
  public async getSecretFromKeyVault(secretName: string): Promise<string | null> {
    if (!this.useKeyVault) {
      throw new Error('Key Vault is not enabled');
    }
    return await this.keyVaultService.getSecret(secretName);
  }

  /**
   * Store a secret directly in Key Vault
   */
  public async storeSecretInKeyVault(secretName: string, secretValue: string): Promise<void> {
    if (!this.useKeyVault) {
      throw new Error('Key Vault is not enabled');
    }
    await this.keyVaultService.setSecret(secretName, secretValue);
  }

  /**
   * Get Key Vault service instance for advanced operations
   */
  public getKeyVaultService(): KeyVaultService {
    return this.keyVaultService;
  }
}