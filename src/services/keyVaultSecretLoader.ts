import { KeyVaultService } from './keyVaultService';
import { logger } from '../utils/logger';

export class KeyVaultSecretLoader {
  private static instance: KeyVaultSecretLoader;
  private keyVaultService: KeyVaultService;
  private initialized = false;

  private constructor() {
    this.keyVaultService = KeyVaultService.getInstance();
  }

  public static getInstance(): KeyVaultSecretLoader {
    if (!KeyVaultSecretLoader.instance) {
      KeyVaultSecretLoader.instance = new KeyVaultSecretLoader();
    }
    return KeyVaultSecretLoader.instance;
  }

  /**
   * Initialize the KeyVaultSecretLoader and load secrets
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Initialize Key Vault service
      await this.keyVaultService.initialize();
      
      // Load secrets from Key Vault and map to environment variables
      await this.loadSecretsFromKeyVault();
      
      this.initialized = true;
      logger.info('✅ Key Vault Secret Loader initialized successfully');
    } catch (error) {
      logger.error('❌ Failed to initialize Key Vault Secret Loader:', error);
      throw error;
    }
  }

  /**
   * Load secrets from Key Vault and map them to environment variables
   */
  private async loadSecretsFromKeyVault(): Promise<void> {
    try {
      // Define the secrets to retrieve from Key Vault
      const secretsToRetrieve = [
        'AZURE-APP-CONFIG-CONNECTION-STRING',
        'AZURE-CLIENT-ID',
        'AZURE-CLIENT-SECRET',
        'AZURE-OPENAI-API-KEY',
        'AZURE-OPENAI-ENDPOINT',
        'AZURE-STORAGE-ACCOUNT-NAME',
        'AZURE-STORAGE-CONNECTION-STRING',
        'AZURE-STORAGE-CONTAINER-NAME',
        'AZURE-TENANT-ID',
        'SQL-DATABASE',
        'SQL-ENCRYPT',
        'SQL-SERVER',
        'SQL-TRUST-SERVER-CERTIFICATE',
        'SQL-USERNAME',
        'SQL-PASSWORD'
      ];

      // Map of Key Vault secret names to environment variable names
      const secretToEnvMap: Record<string, string> = {
        'AZURE-APP-CONFIG-CONNECTION-STRING': 'AZURE_APP_CONFIG_CONNECTION_STRING',
        'AZURE-CLIENT-ID': 'AZURE_CLIENT_ID',
        'AZURE-CLIENT-SECRET': 'AZURE_CLIENT_SECRET',
        'AZURE-OPENAI-API-KEY': 'AZURE_OPENAI_API_KEY',
        'AZURE-OPENAI-ENDPOINT': 'AZURE_OPENAI_ENDPOINT',
        'AZURE-STORAGE-ACCOUNT-NAME': 'AZURE_STORAGE_ACCOUNT_NAME',
        'AZURE-STORAGE-CONNECTION-STRING': 'AZURE_STORAGE_CONNECTION_STRING',
        'AZURE-STORAGE-CONTAINER-NAME': 'AZURE_STORAGE_CONTAINER_NAME',
        'AZURE-TENANT-ID': 'AZURE_TENANT_ID',
        'SQL-DATABASE': 'SQL_DATABASE',
        'SQL-ENCRYPT': 'SQL_ENCRYPT',
        'SQL-SERVER': 'SQL_SERVER',
        'SQL-TRUST-SERVER-CERTIFICATE': 'SQL_TRUST_SERVER_CERTIFICATE',
        'SQL-USERNAME': 'SQL_USERNAME',
        'SQL-PASSWORD': 'SQL_PASSWORD'
      };

      // Retrieve secrets from Key Vault
      const loadedSecrets: Record<string, string | null> = {};
      let loadedCount = 0;

      for (const secretName of secretsToRetrieve) {
        try {
          const secretValue = await this.keyVaultService.getSecret(secretName);
          if (secretValue) {
            loadedSecrets[secretName] = secretValue;
            loadedCount++;
          } else {
            logger.warn(`Secret '${secretName}' not found in Key Vault`);
          }
        } catch (error) {
          logger.error(`Failed to retrieve secret '${secretName}' from Key Vault:`, error);
        }
      }

      // Map secrets to environment variables
      for (const [secretName, secretValue] of Object.entries(loadedSecrets)) {
        if (secretValue && secretToEnvMap[secretName]) {
          process.env[secretToEnvMap[secretName]] = secretValue;
          logger.debug(`✅ Mapped Key Vault secret '${secretName}' to environment variable '${secretToEnvMap[secretName]}'`);
        }
      }

      logger.info(`✅ Loaded ${loadedCount} secrets from Key Vault and mapped to environment variables`);
    } catch (error) {
      logger.error('❌ Failed to load secrets from Key Vault:', error);
      throw error;
    }
  }

  /**
   * Get a specific secret from Key Vault
   */
  public async getSecret(secretName: string): Promise<string | null> {
    try {
      return await this.keyVaultService.getSecret(secretName);
    } catch (error) {
      logger.error(`Failed to get secret '${secretName}' from Key Vault:`, error);
      return null;
    }
  }

  /**
   * Check if the KeyVaultSecretLoader is initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }
}