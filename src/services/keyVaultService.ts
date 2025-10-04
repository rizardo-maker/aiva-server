import { SecretClient } from '@azure/keyvault-secrets';
import { DefaultAzureCredential, ClientSecretCredential } from '@azure/identity';
import { logger } from '../utils/logger';

export interface KeyVaultConfig {
  keyVaultUrl: string;
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
}

export class KeyVaultService {
  private static instance: KeyVaultService;
  private secretClient: SecretClient | null = null;
  private initialized = false;
  private keyVaultUrl: string = '';

  private constructor() {}

  public static getInstance(): KeyVaultService {
    if (!KeyVaultService.instance) {
      KeyVaultService.instance = new KeyVaultService();
    }
    return KeyVaultService.instance;
  }

  public async initialize(config?: KeyVaultConfig): Promise<void> {
    if (this.initialized && this.secretClient) return;

    // Check if Key Vault is disabled for development
    if (process.env.DISABLE_KEY_VAULT === 'true') {
      logger.info('🔧 Key Vault disabled for development mode');
      this.initialized = true;
      return;
    }

    try {
      // Get Key Vault URL from config or environment
      this.keyVaultUrl = config?.keyVaultUrl || 
                        process.env.AZURE_KEY_VAULT_URL || 
                        process.env.KEY_VAULT_URL || 'https://aivakeys.vault.azure.net/';

      if (!this.keyVaultUrl) {
        throw new Error('Azure Key Vault URL is required. Set AZURE_KEY_VAULT_URL environment variable.');
      }

      // Ensure URL format is correct
      if (!this.keyVaultUrl.startsWith('https://')) {
        this.keyVaultUrl = `https://${this.keyVaultUrl}.vault.azure.net/`;
      }
      if (!this.keyVaultUrl.endsWith('/')) {
        this.keyVaultUrl += '/';
      }

      // Initialize credential
      let credential;
      
      if (config?.tenantId && config?.clientId && config?.clientSecret) {
        // Use service principal credentials
        credential = new ClientSecretCredential(
          config.tenantId,
          config.clientId,
          config.clientSecret
        );
        logger.info('Using Service Principal authentication for Key Vault');
      } else if (process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET) {
        // Use service principal from environment
        credential = new ClientSecretCredential(
          process.env.AZURE_TENANT_ID,
          process.env.AZURE_CLIENT_ID,
          process.env.AZURE_CLIENT_SECRET
        );
        logger.info('Using Service Principal authentication for Key Vault from environment');
      } else {
        // Use default Azure credential (managed identity, Azure CLI, etc.)
        credential = new DefaultAzureCredential();
        logger.info('Using Default Azure Credential for Key Vault');
      }

      // Initialize Secret Client
      this.secretClient = new SecretClient(this.keyVaultUrl, credential);

      // Test connection by attempting to list secrets (with minimal permissions)
      try {
        const secretsIterator = this.secretClient.listPropertiesOfSecrets();
        await secretsIterator.next();
        logger.info('✅ Key Vault connection verified');
      } catch (error) {
        logger.warn('⚠️ Key Vault connection test failed, but client initialized. Check permissions:', error);
      }

      this.initialized = true;
      logger.info(`✅ Azure Key Vault Service initialized with URL: ${this.keyVaultUrl}`);
    } catch (error) {
      logger.error('❌ Failed to initialize Azure Key Vault Service:', error);
      throw error;
    }
  }

  public async getSecret(secretName: string): Promise<string | null> {
    // If Key Vault is disabled, return null (fallback to environment variables)
    if (process.env.DISABLE_KEY_VAULT === 'true') {
      logger.debug(`Key Vault disabled, returning null for secret: ${secretName}`);
      return null;
    }

    if (!this.secretClient) {
      throw new Error('Key Vault Service not initialized. Call initialize() first.');
    }

    try {
      // Convert name to Key Vault compatible format (replace special characters)
      const vaultSecretName = this.sanitizeSecretName(secretName);
      
      const secret = await this.secretClient.getSecret(vaultSecretName);
      
      if (secret.value) {
        logger.debug(`✅ Retrieved secret: ${secretName}`);
        return secret.value;
      }
      
      logger.warn(`⚠️ Secret '${secretName}' exists but has no value`);
      return null;
    } catch (error: any) {
      if (error.statusCode === 404) {
        logger.debug(`Secret '${secretName}' not found in Key Vault`);
        return null;
      }
      
      logger.error(`❌ Failed to retrieve secret '${secretName}':`, error);
      throw error;
    }
  }

  public async setSecret(secretName: string, secretValue: string, contentType?: string): Promise<void> {
    if (!this.secretClient) {
      throw new Error('Key Vault Service not initialized. Call initialize() first.');
    }

    try {
      const vaultSecretName = this.sanitizeSecretName(secretName);
      
      const secretProperties = {
        value: secretValue,
        contentType: contentType || 'text/plain'
      };

      await this.secretClient.setSecret(vaultSecretName, secretValue);
      logger.info(`✅ Secret '${secretName}' stored in Key Vault`);
    } catch (error) {
      logger.error(`❌ Failed to store secret '${secretName}':`, error);
      throw error;
    }
  }

  public async deleteSecret(secretName: string): Promise<void> {
    if (!this.secretClient) {
      throw new Error('Key Vault Service not initialized. Call initialize() first.');
    }

    try {
      const vaultSecretName = this.sanitizeSecretName(secretName);
      
      const deleteOperation = await this.secretClient.beginDeleteSecret(vaultSecretName);
      await deleteOperation.pollUntilDone();
      
      logger.info(`✅ Secret '${secretName}' deleted from Key Vault`);
    } catch (error: any) {
      if (error.statusCode === 404) {
        logger.warn(`⚠️ Secret '${secretName}' not found for deletion`);
        return;
      }
      
      logger.error(`❌ Failed to delete secret '${secretName}':`, error);
      throw error;
    }
  }

  public async listSecrets(): Promise<string[]> {
    if (!this.secretClient) {
      throw new Error('Key Vault Service not initialized. Call initialize() first.');
    }

    try {
      const secretNames: string[] = [];
      
      for await (const secretProperties of this.secretClient.listPropertiesOfSecrets()) {
        if (secretProperties.name) {
          secretNames.push(this.desanitizeSecretName(secretProperties.name));
        }
      }
      
      logger.debug(`✅ Listed ${secretNames.length} secrets from Key Vault`);
      return secretNames;
    } catch (error) {
      logger.error('❌ Failed to list secrets:', error);
      throw error;
    }
  }

  public async secretExists(secretName: string): Promise<boolean> {
    if (!this.secretClient) {
      throw new Error('Key Vault Service not initialized. Call initialize() first.');
    }

    try {
      const vaultSecretName = this.sanitizeSecretName(secretName);
      await this.secretClient.getSecret(vaultSecretName);
      return true;
    } catch (error: any) {
      if (error.statusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  public async updateSecret(secretName: string, secretValue: string): Promise<void> {
    await this.setSecret(secretName, secretValue);
  }

  /**
   * Batch retrieve multiple secrets efficiently
   */
  public async getSecrets(secretNames: string[]): Promise<Record<string, string | null>> {
    const results: Record<string, string | null> = {};
    
    const promises = secretNames.map(async (name) => {
      try {
        const value = await this.getSecret(name);
        results[name] = value;
      } catch (error) {
        logger.warn(`Failed to retrieve secret '${name}':`, error);
        results[name] = null;
      }
    });

    await Promise.all(promises);
    return results;
  }

  /**
   * Batch store multiple secrets efficiently
   */
  public async setSecrets(secrets: Record<string, string>): Promise<void> {
    const promises = Object.entries(secrets).map(([name, value]) => 
      this.setSecret(name, value)
    );

    await Promise.all(promises);
    logger.info(`✅ Stored ${Object.keys(secrets).length} secrets in Key Vault`);
  }

  /**
   * Convert secret names to Key Vault compatible format
   * Key Vault secret names can only contain alphanumeric characters and hyphens
   */
  private sanitizeSecretName(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9-]/g, '-')  // Replace invalid chars with hyphens
      .replace(/-+/g, '-')              // Replace multiple hyphens with single
      .replace(/^-|-$/g, '')            // Remove leading/trailing hyphens
      .substring(0, 127);               // Key Vault name limit
  }

  /**
   * Convert Key Vault secret names back to original format
   */
  private desanitizeSecretName(vaultName: string): string {
    // This is a simple reverse - in production you might want to store
    // a mapping of original names to vault names
    return vaultName.replace(/-/g, '_');
  }

  public isInitialized(): boolean {
    return this.initialized && this.secretClient !== null;
  }

  public getKeyVaultUrl(): string {
    return this.keyVaultUrl;
  }

  /**
   * Reset instance for testing or reinitialization
   */
  public static resetInstance(): void {
    if (KeyVaultService.instance) {
      KeyVaultService.instance.initialized = false;
      KeyVaultService.instance.secretClient = null;
    }
    KeyVaultService.instance = new KeyVaultService();
  }
}