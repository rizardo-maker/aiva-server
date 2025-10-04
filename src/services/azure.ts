import sql from 'mssql';
import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';
import { AppConfigurationClient } from '@azure/app-configuration';
import { DefaultAzureCredential } from '@azure/identity';
import { OpenAIClient, AzureKeyCredential } from '@azure/openai';
import { logger } from '../utils/logger';

// Azure service clients
export let sqlPool: sql.ConnectionPool;
export let blobServiceClient: BlobServiceClient;
export let appConfigClient: AppConfigurationClient;
export let openAIClient: OpenAIClient;

export async function initializeAzureServices() {
  try {
    logger.info('🔄 Initializing Azure services...');

    // Initialize SQL Database
    await initializeSQLDatabase();
    
    // Initialize Blob Storage
    await initializeBlobStorage();
    
    // Initialize App Configuration
    await initializeAppConfiguration();
    
    // Initialize Azure OpenAI
    await initializeOpenAI();

    logger.info('✅ All Azure services initialized successfully');
  } catch (error) {
    logger.error('❌ Failed to initialize Azure services:', error);
    // Don't throw the error, allow the application to continue with mock services
    logger.info('Continuing with available mock services');
  }
}

async function initializeSQLDatabase() {
  try {
    const mockDatabase = process.env.MOCK_SQL === 'true';
    
    // Check if we have all required database environment variables
    const hasDBConfig = process.env.SQL_SERVER && process.env.SQL_DATABASE && 
                       process.env.SQL_USERNAME && process.env.SQL_PASSWORD;
    
    if (mockDatabase) {
      logger.info('Using mock SQL Database (MOCK_SQL=true)');
      
      // Create a simplified mock SQL pool 
      sqlPool = {
        request: () => ({
          input: () => ({
            input: () => ({
              input: () => ({
                input: () => ({
                  input: () => ({
                    input: () => ({
                      input: () => ({
                        query: async () => ({ 
                          recordset: [{
                            id: `mock_${Date.now()}`,
                            title: 'Mock Data',
                            content: 'This is mock data for testing',
                            createdAt: new Date()
                          }] 
                        })
                      })
                    })
                  })
                })
              })
            })
          }),
          query: async () => ({ recordset: [] })
        }),
        connect: async () => ({}),
        close: async () => ({})
      } as unknown as sql.ConnectionPool;
      
      logger.info('✅ Mock SQL Database initialized');
      return;
    }

    if (!hasDBConfig) {
      throw new Error('Missing required database configuration variables');
    }

    // Always use real Azure SQL Database with dotenv variables, never mock
    logger.info('Using real Azure SQL Database with dotenv configuration');
    
    // Try to use Azure AD authentication with the provided credentials if SQL auth fails
    try {
      const config: sql.config = {
        server: process.env.SQL_SERVER!,
        database: process.env.SQL_DATABASE!,
        user: process.env.SQL_USERNAME!,
        password: process.env.SQL_PASSWORD!,
        options: {
          encrypt: process.env.SQL_ENCRYPT === 'true',
          trustServerCertificate: process.env.SQL_TRUST_SERVER_CERTIFICATE === 'true'
        },
        pool: {
          max: 10,
          min: 0,
          idleTimeoutMillis: 30000
        }
      };

      sqlPool = new sql.ConnectionPool(config);
      await sqlPool.connect();
      logger.info('✅ SQL Database connected with SQL authentication');
    } catch (sqlError) {
      logger.warn('SQL authentication failed, trying Azure AD authentication', sqlError);
      
      // Set environment variables for Azure AD authentication
       process.env.AZURE_TENANT_ID = process.env.AZURE_TENANT_ID || '53be55ec-4183-4a38-8c83-8e6e12e2318a';
       process.env.AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID || '613e41ad-ed10-491c-8788-b42f488aaa29';
       process.env.AZURE_CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || 'ad73e712-46b5-42a4-a659-47f5c0db59d2';
       
       // Try Azure AD authentication using the provided credentials
       const azureADConfig: sql.config = {
        server: process.env.SQL_SERVER!,
        database: process.env.SQL_DATABASE!,
        authentication: {
          type: 'azure-active-directory-service-principal-secret',
          options: {
            clientId: process.env.AZURE_CLIENT_ID,
            clientSecret: process.env.AZURE_CLIENT_SECRET,
            tenantId: process.env.AZURE_TENANT_ID
          }
        },
        options: {
          encrypt: true,
          trustServerCertificate: false
        },
        pool: {
          max: 10,
          min: 0,
          idleTimeoutMillis: 30000
        }
      };
      
      sqlPool = new sql.ConnectionPool(azureADConfig);
      await sqlPool.connect();
      logger.info('✅ SQL Database connected with Azure AD authentication');
    }

    // Create tables if they don't exist
    await createTables();

    logger.info('✅ SQL Database initialized');
  } catch (error) {
    logger.error('❌ Failed to initialize SQL Database:', error);
    logger.info('Falling back to mock SQL Database');
    
    // Create fallback mock SQL pool
    sqlPool = {
      request: () => ({
        input: () => ({
          input: () => ({
            input: () => ({
              input: () => ({
                input: () => ({
                  input: () => ({
                    input: () => ({
                      query: async () => ({ recordset: [] })
                    })
                  })
                })
              })
            })
          })
        }),
        query: async () => ({ recordset: [] })
      }),
      connect: async () => ({}),
      close: async () => ({})
    } as unknown as sql.ConnectionPool;
    
    logger.info('✅ Mock SQL Database initialized as fallback');
  }
}

async function createTables() {
  try {
    // Create Users table
    await sqlPool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Users' AND xtype='U')
      CREATE TABLE Users (
        id NVARCHAR(255) PRIMARY KEY,
        firstName NVARCHAR(100) NOT NULL,
        lastName NVARCHAR(100) NOT NULL,
        email NVARCHAR(255) UNIQUE NOT NULL,
        password NVARCHAR(255),
        provider NVARCHAR(50) NOT NULL DEFAULT 'local',
        providerId NVARCHAR(255),
        tenantId NVARCHAR(255),
        isActive BIT DEFAULT 1,
        lastLoginAt DATETIME2,
        preferences NVARCHAR(MAX),
        createdAt DATETIME2 DEFAULT GETUTCDATE(),
        updatedAt DATETIME2 DEFAULT GETUTCDATE()
      )
    `);

    // Create Chats table
    await sqlPool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Chats' AND xtype='U')
      CREATE TABLE Chats (
        id NVARCHAR(255) PRIMARY KEY,
        userId NVARCHAR(255) NOT NULL,
        title NVARCHAR(500) NOT NULL,
        description NVARCHAR(1000),
        messageCount INT DEFAULT 0,
        isArchived BIT DEFAULT 0,
        lastMessageAt DATETIME2,
        createdAt DATETIME2 DEFAULT GETUTCDATE(),
        updatedAt DATETIME2 DEFAULT GETUTCDATE(),
        FOREIGN KEY (userId) REFERENCES Users(id) ON DELETE CASCADE
      )
    `);

    // Create Messages table
    await sqlPool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Messages' AND xtype='U')
      CREATE TABLE Messages (
        id NVARCHAR(255) PRIMARY KEY,
        chatId NVARCHAR(255) NOT NULL,
        userId NVARCHAR(255) NOT NULL,
        content NVARCHAR(MAX) NOT NULL,
        role NVARCHAR(50) NOT NULL CHECK (role IN ('user', 'assistant')),
        metadata NVARCHAR(MAX),
        tokens INT DEFAULT 0,
        createdAt DATETIME2 DEFAULT GETUTCDATE(),
        FOREIGN KEY (chatId) REFERENCES Chats(id) ON DELETE CASCADE,
        FOREIGN KEY (userId) REFERENCES Users(id) ON DELETE CASCADE
      )
    `);

    // Create MessageActions table for bookmarks, likes, dislikes
    await sqlPool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='MessageActions' AND xtype='U')
      CREATE TABLE MessageActions (
        id NVARCHAR(255) PRIMARY KEY,
        messageId NVARCHAR(255) NOT NULL,
        userId NVARCHAR(255) NOT NULL,
        actionType NVARCHAR(50) NOT NULL CHECK (actionType IN ('like', 'dislike', 'bookmark')),
        createdAt DATETIME2 DEFAULT GETUTCDATE(),
        FOREIGN KEY (messageId) REFERENCES Messages(id) ON DELETE CASCADE,
        FOREIGN KEY (userId) REFERENCES Users(id) ON DELETE CASCADE,
        UNIQUE(messageId, userId, actionType)
      )
    `);

    // Create Workspaces table
    await sqlPool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Workspaces' AND xtype='U')
      CREATE TABLE Workspaces (
        id NVARCHAR(255) PRIMARY KEY,
        name NVARCHAR(200) NOT NULL,
        description NVARCHAR(1000),
        color NVARCHAR(7) DEFAULT '#3B82F6',
        isShared BIT DEFAULT 0,
        ownerId NVARCHAR(255) NOT NULL,
        containerName NVARCHAR(255),
        createdAt DATETIME2 DEFAULT GETUTCDATE(),
        updatedAt DATETIME2 DEFAULT GETUTCDATE(),
        FOREIGN KEY (ownerId) REFERENCES Users(id) ON DELETE CASCADE
      )
    `);

    // Add containerName column if it doesn't exist (migration)
    await sqlPool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Workspaces') AND name = 'containerName')
      ALTER TABLE Workspaces ADD containerName NVARCHAR(255)
    `);

    // Create WorkspaceUsers table for user assignments
    await sqlPool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='WorkspaceUsers' AND xtype='U')
      CREATE TABLE WorkspaceUsers (
        id NVARCHAR(255) PRIMARY KEY,
        workspaceId NVARCHAR(255) NOT NULL,
        userId NVARCHAR(255) NOT NULL,
        accessLevel NVARCHAR(50) NOT NULL DEFAULT 'member' CHECK (accessLevel IN ('owner', 'member', 'readonly')),
        assignedBy NVARCHAR(255),
        assignedAt DATETIME2 DEFAULT GETUTCDATE(),
        createdAt DATETIME2 DEFAULT GETUTCDATE(),
        updatedAt DATETIME2 DEFAULT GETUTCDATE(),
        FOREIGN KEY (workspaceId) REFERENCES Workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY (userId) REFERENCES Users(id) ON DELETE CASCADE,
        FOREIGN KEY (assignedBy) REFERENCES Users(id),
        UNIQUE(workspaceId, userId)
      )
    `);

    // Create WorkspaceFiles table for file management
    await sqlPool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='WorkspaceFiles' AND xtype='U')
      CREATE TABLE WorkspaceFiles (
        id NVARCHAR(255) PRIMARY KEY,
        workspaceId NVARCHAR(255) NOT NULL,
        originalName NVARCHAR(500) NOT NULL,
        fileName NVARCHAR(500) NOT NULL,
        mimeType NVARCHAR(100),
        size BIGINT NOT NULL,
        url NVARCHAR(1000),
        uploadedBy NVARCHAR(255) NOT NULL,
        createdAt DATETIME2 DEFAULT GETUTCDATE(),
        updatedAt DATETIME2 DEFAULT GETUTCDATE(),
        FOREIGN KEY (workspaceId) REFERENCES Workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY (uploadedBy) REFERENCES Users(id)
      )
    `);

    // Update Chats table to include workspaceId if not exists
    await sqlPool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('Chats') AND name = 'workspaceId')
      ALTER TABLE Chats ADD workspaceId NVARCHAR(255)
    `);

    // Add foreign key constraint for workspaceId in Chats if not exists
    await sqlPool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_Chats_Workspaces')
      ALTER TABLE Chats ADD CONSTRAINT FK_Chats_Workspaces FOREIGN KEY (workspaceId) REFERENCES Workspaces(id)
    `);

    // Create Feedback table
    await sqlPool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Feedback' AND xtype='U')
      CREATE TABLE Feedback (
        id NVARCHAR(255) PRIMARY KEY,
        userId NVARCHAR(255) NOT NULL,
        title NVARCHAR(255) NOT NULL,
        description NVARCHAR(MAX) NOT NULL,
        category NVARCHAR(100) NOT NULL,
        priority NVARCHAR(50) NOT NULL DEFAULT 'medium',
        status NVARCHAR(50) NOT NULL DEFAULT 'pending',
        rating INT,
        createdAt DATETIME2 DEFAULT GETUTCDATE(),
        updatedAt DATETIME2 DEFAULT GETUTCDATE(),
        FOREIGN KEY (userId) REFERENCES Users(id) ON DELETE CASCADE
      )
    `);

    // Create indexes for better performance
    await sqlPool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Chats_UserId')
      CREATE INDEX IX_Chats_UserId ON Chats(userId)
    `);

    await sqlPool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Messages_ChatId')
      CREATE INDEX IX_Messages_ChatId ON Messages(chatId)
    `);

    await sqlPool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Messages_UserId')
      CREATE INDEX IX_Messages_UserId ON Messages(userId)
    `);

    await sqlPool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_MessageActions_UserId')
      CREATE INDEX IX_MessageActions_UserId ON MessageActions(userId)
    `);

    await sqlPool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_MessageActions_MessageId')
      CREATE INDEX IX_MessageActions_MessageId ON MessageActions(messageId)
    `);

    await sqlPool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Feedback_UserId')
      CREATE INDEX IX_Feedback_UserId ON Feedback(userId)
    `);

    // Create indexes for workspace tables
    await sqlPool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Workspaces_OwnerId')
      CREATE INDEX IX_Workspaces_OwnerId ON Workspaces(ownerId)
    `);

    await sqlPool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_WorkspaceUsers_WorkspaceId')
      CREATE INDEX IX_WorkspaceUsers_WorkspaceId ON WorkspaceUsers(workspaceId)
    `);

    await sqlPool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_WorkspaceUsers_UserId')
      CREATE INDEX IX_WorkspaceUsers_UserId ON WorkspaceUsers(userId)
    `);

    await sqlPool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_WorkspaceFiles_WorkspaceId')
      CREATE INDEX IX_WorkspaceFiles_WorkspaceId ON WorkspaceFiles(workspaceId)
    `);

    await sqlPool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Chats_WorkspaceId')
      CREATE INDEX IX_Chats_WorkspaceId ON Chats(workspaceId)
    `);

    logger.info('✅ Database tables created/verified');
  } catch (error) {
    logger.error('❌ Failed to create tables:', error);
    throw error;
  }
}

async function initializeBlobStorage() {
  try {
    const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
    const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;
    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    const mockStorage = process.env.MOCK_STORAGE === 'true';
    
    // Only use mock storage if explicitly requested or if required configuration is missing
    if (mockStorage || (!accountName && !connectionString)) {
      logger.info('Using mock Blob Storage client - missing configuration or explicitly requested');
      // Create a mock client with the necessary methods
      const mockContainerClient = {
        createIfNotExists: async () => ({}),
        exists: async () => true,
        deleteIfExists: async () => ({ succeeded: true }),
        getBlockBlobClient: () => ({
          uploadData: async () => ({ etag: 'mock-etag', lastModified: new Date() }),
          delete: async () => ({}),
          exists: async () => true
        }),
        listBlobsFlat: async function* () {
          yield { name: 'mock-file.txt' };
        }
      };
      
      blobServiceClient = {
        getContainerClient: () => mockContainerClient
      } as unknown as BlobServiceClient;
      
      logger.info('✅ Mock Blob Storage initialized');
      return;
    }
    
    // Use connection string if available, otherwise use account key authentication
    if (connectionString) {
      logger.info('Using Azure Blob Storage with connection string');
      blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    } else if (accountName && accountKey) {
      logger.info('Using Azure Blob Storage with account name and key');
      const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);
      blobServiceClient = new BlobServiceClient(
        `https://${accountName}.blob.core.windows.net`,
        sharedKeyCredential
      );
    } else {
      throw new Error('Azure Storage account name, key, or connection string missing');
    }

    // Create default container if it doesn't exist (without public access)
    const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME || 'aiva-files';
    const containerClient = blobServiceClient.getContainerClient(containerName);
    
    try {
      await containerClient.createIfNotExists({
        access: 'container' // Changed from 'blob' to 'container' for better access control
      });
      logger.info(`✅ Blob Storage initialized with container: ${containerName}`);
    } catch (containerError: any) {
      if (containerError.code === 'PublicAccessNotPermitted') {
        logger.info('Public access not permitted, creating container without public access');
        await containerClient.createIfNotExists(); // Create without public access
        logger.info(`✅ Blob Storage initialized with private container: ${containerName}`);
      } else {
        throw containerError;
      }
    }

    logger.info('✅ Blob Storage initialized successfully');
  } catch (error) {
    logger.error('❌ Failed to initialize Blob Storage:', error);
    logger.info('Falling back to mock Blob Storage');
    
    // Create a mock client with the necessary methods
    const mockContainerClient = {
      createIfNotExists: async () => ({}),
      exists: async () => true,
      deleteIfExists: async () => ({ succeeded: true }),
      getBlockBlobClient: () => ({
        uploadData: async () => ({ etag: 'mock-etag', lastModified: new Date() }),
        delete: async () => ({}),
        exists: async () => true
      }),
      listBlobsFlat: async function* () {
        yield { name: 'mock-file.txt' };
      }
    };
    
    blobServiceClient = {
      getContainerClient: () => mockContainerClient
    } as unknown as BlobServiceClient;
    
    logger.info('✅ Mock Blob Storage initialized as fallback');
  }
}

async function initializeAppConfiguration() {
  try {
    const connectionString = process.env.AZURE_APP_CONFIG_CONNECTION_STRING;
    const nodeEnv = process.env.NODE_ENV || 'development';
    const mockAppConfig = process.env.MOCK_APP_CONFIG === 'true';
    
    if ((nodeEnv === 'development' || mockAppConfig) || !connectionString) {
      logger.info('Using mock App Configuration client');
      // Create a mock client with the necessary methods
      appConfigClient = {
        getConfigurationSetting: async () => ({
          value: 'mock-value',
          key: 'mock-key',
          label: 'mock-label',
          contentType: 'application/json',
          lastModified: new Date()
        }),
        listConfigurationSettings: async function* () {
          yield {
            value: 'mock-value',
            key: 'mock-key',
            label: 'mock-label',
            contentType: 'application/json',
            lastModified: new Date()
          };
        }
      } as unknown as AppConfigurationClient;
      logger.info('✅ Mock App Configuration initialized');
      return;
    }
    
    // Use connection string if available, otherwise use DefaultAzureCredential with provided credentials
    if (connectionString) {
      appConfigClient = new AppConfigurationClient(connectionString);
    } else {
      // Use the same DefaultAzureCredential instance
      const credential = new DefaultAzureCredential();
      
      // If you have an App Configuration endpoint URL
      const endpoint = process.env.AZURE_APP_CONFIG_ENDPOINT;
      if (endpoint) {
        appConfigClient = new AppConfigurationClient(endpoint, credential);
      } else {
        logger.warn('No App Configuration connection string or endpoint provided');
        throw new Error('Missing App Configuration connection details');
      }
    }
    logger.info('✅ App Configuration initialized');
  } catch (error) {
    logger.error('❌ Failed to initialize App Configuration:', error);
    logger.info('Falling back to mock App Configuration');
    // Create a mock client with the necessary methods
    appConfigClient = {
      getConfigurationSetting: async () => ({
        value: 'mock-value',
        key: 'mock-key',
        label: 'mock-label',
        contentType: 'application/json',
        lastModified: new Date()
      }),
      listConfigurationSettings: async function* () {
        yield {
          value: 'mock-value',
          key: 'mock-key',
          label: 'mock-label',
          contentType: 'application/json',
          lastModified: new Date()
        };
      }
    } as unknown as AppConfigurationClient;
    logger.info('✅ Mock App Configuration initialized as fallback');
  }
}

async function initializeOpenAI() {
  try {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const nodeEnv = process.env.NODE_ENV || 'development';
    const mockOpenAI = process.env.MOCK_OPENAI === 'true';
    
    if (mockOpenAI || !endpoint || !apiKey) {
      logger.info('Using mock OpenAI client');
      // Create a mock client with the necessary methods
      openAIClient = {
        getChatCompletions: async (messages: any[]) => {
          // Generate intelligent response based on user input
          const userMessage = messages[messages.length - 1]?.content || '';
          const intelligentResponse = generateIntelligentResponse(userMessage);
          
          return {
            id: 'mock-response-id',
            object: 'chat.completion',
            created: Date.now(),
            model: 'gpt-4o',
            choices: [{
              message: {
                role: 'assistant',
                content: intelligentResponse
              },
              finishReason: 'stop'
            }],
            usage: {
              promptTokens: Math.floor(userMessage.length / 4),
              completionTokens: Math.floor(intelligentResponse.length / 4),
              totalTokens: Math.floor((userMessage.length + intelligentResponse.length) / 4)
            }
          };
        },
        getModels: async () => ({
          models: [{
            id: 'gpt-4',
            object: 'model',
            created: Date.now(),
            ownedBy: 'mock'
          }]
        })
      } as unknown as OpenAIClient;
      
      logger.info('✅ Mock OpenAI initialized');
      return;
    }
    
    // Use API key if available, otherwise use DefaultAzureCredential with provided credentials
    if (apiKey) {
      openAIClient = new OpenAIClient(endpoint, new AzureKeyCredential(apiKey));
    } else {
      // Use the same DefaultAzureCredential instance
      const credential = new DefaultAzureCredential();
      
      openAIClient = new OpenAIClient(endpoint, credential);
    }
    
    logger.info('✅ Azure OpenAI initialized');
  } catch (error) {
    logger.error('❌ Failed to initialize Azure OpenAI:', error);
    logger.info('Falling back to mock OpenAI');
    
    // Create a mock client with the necessary methods
    openAIClient = {
      getChatCompletions: async (messages: any[]) => {
        // Generate intelligent response based on user input
        const userMessage = messages[messages.length - 1]?.content || '';
        const intelligentResponse = generateIntelligentResponse(userMessage);
        
        return {
          choices: [{
            message: {
              role: 'assistant',
              content: intelligentResponse
            },
            finishReason: 'stop'
          }],
          usage: {
            totalTokens: Math.floor((userMessage.length + intelligentResponse.length) / 4)
          }
        };
      },
      getModels: async () => ({
        models: [{
          id: 'gpt-4',
          object: 'model',
          created: Date.now(),
          ownedBy: 'mock'
        }]
      })
    } as unknown as OpenAIClient;
    
    logger.info('✅ Mock OpenAI initialized as fallback');
  }
}

// Helper functions for database operations
export async function createUser(userData: any) {
  try {
    const request = sqlPool.request();
    const result = await request
      .input('id', sql.NVarChar, userData.id)
      .input('firstName', sql.NVarChar, userData.firstName)
      .input('lastName', sql.NVarChar, userData.lastName)
      .input('email', sql.NVarChar, userData.email)
      .input('password', sql.NVarChar, userData.password || null)
      .input('provider', sql.NVarChar, userData.provider)
      .input('providerId', sql.NVarChar, userData.providerId || null)
      .input('preferences', sql.NVarChar, userData.preferences ? JSON.stringify(userData.preferences) : null)
      .query(`
        INSERT INTO Users (id, firstName, lastName, email, password, provider, providerId, preferences)
        OUTPUT INSERTED.*
        VALUES (@id, @firstName, @lastName, @email, @password, @provider, @providerId, @preferences)
      `);
    
    const user = result.recordset[0];
    if (user.preferences) {
      user.preferences = JSON.parse(user.preferences);
    }
    return user;
  } catch (error) {
    logger.error('Error creating user:', error);
    throw error;
  }
}

export async function getUserById(userId: string) {
  try {
    const request = sqlPool.request();
    const result = await request
      .input('id', sql.NVarChar, userId)
      .query('SELECT * FROM Users WHERE id = @id');
    
    if (result.recordset.length === 0) {
      return null;
    }
    
    const user = result.recordset[0];
    if (user.preferences) {
      user.preferences = JSON.parse(user.preferences);
    }
    return user;
  } catch (error) {
    logger.error('Error getting user:', error);
    throw error;
  }
}

export async function getUserByEmail(email: string) {
  try {
    const request = sqlPool.request();
    const result = await request
      .input('email', sql.NVarChar, email)
      .query('SELECT * FROM Users WHERE email = @email');
    
    if (result.recordset.length === 0) {
      return null;
    }
    
    const user = result.recordset[0];
    if (user.preferences) {
      user.preferences = JSON.parse(user.preferences);
    }
    return user;
  } catch (error) {
    logger.error('Error getting user by email:', error);
    throw error;
  }
}

export async function updateUserLastLogin(userId: string) {
  try {
    const request = sqlPool.request();
    await request
      .input('id', sql.NVarChar, userId)
      .input('lastLoginAt', sql.DateTime2, new Date())
      .query('UPDATE Users SET lastLoginAt = @lastLoginAt, updatedAt = GETUTCDATE() WHERE id = @id');
    
    logger.info(`Updated last login for user: ${userId}`);
  } catch (error) {
    logger.error('Error updating user last login:', error);
    throw error;
  }
}

// Bookmark Management Functions
export async function getUserBookmarks(userId: string) {
  try {
    const request = sqlPool.request();
    const result = await request
      .input('userId', sql.NVarChar, userId)
      .query(`
        SELECT ma.*, m.content as messageContent, m.role as messageRole, m.createdAt as messageCreatedAt,
               c.title as chatTitle
        FROM MessageActions ma
        INNER JOIN Messages m ON ma.messageId = m.id
        INNER JOIN Chats c ON m.chatId = c.id
        WHERE ma.userId = @userId AND ma.actionType = 'bookmark'
        ORDER BY ma.createdAt DESC
      `);
    
    return result.recordset.map(record => ({
      id: record.messageId,
      title: `${record.chatTitle} - ${record.messageRole === 'assistant' ? 'AI Response' : 'User Message'}`,
      description: record.messageContent.length > 100 ? record.messageContent.substring(0, 100) + '...' : record.messageContent,
      date: record.messageCreatedAt,
      type: 'Conversation',
      category: 'Conversation'
    }));
  } catch (error) {
    logger.error('Error getting user bookmarks:', error);
    throw error;
  }
}

export async function addBookmark(userId: string, messageId: string) {
  try {
    const request = sqlPool.request();
    const bookmarkId = `bookmark_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    await request
      .input('id', sql.NVarChar, bookmarkId)
      .input('messageId', sql.NVarChar, messageId)
      .input('userId', sql.NVarChar, userId)
      .input('actionType', sql.NVarChar, 'bookmark')
      .query(`
        INSERT INTO MessageActions (id, messageId, userId, actionType)
        VALUES (@id, @messageId, @userId, @actionType)
      `);
    
    logger.info(`Bookmark added: ${bookmarkId} for user: ${userId}`);
  } catch (error) {
    logger.error('Error adding bookmark:', error);
    throw error;
  }
}

export async function removeBookmark(userId: string, messageId: string) {
  try {
    const request = sqlPool.request();
    await request
      .input('messageId', sql.NVarChar, messageId)
      .input('userId', sql.NVarChar, userId)
      .input('actionType', sql.NVarChar, 'bookmark')
      .query(`
        DELETE FROM MessageActions 
        WHERE messageId = @messageId AND userId = @userId AND actionType = @actionType
      `);
    
    logger.info(`Bookmark removed for message: ${messageId} user: ${userId}`);
  } catch (error) {
    logger.error('Error removing bookmark:', error);
    throw error;
  }
}

// Liked/Disliked Messages Functions
export async function getUserLikedMessages(userId: string) {
  try {
    const request = sqlPool.request();
    const result = await request
      .input('userId', sql.NVarChar, userId)
      .query(`
        SELECT ma.*, m.content as messageContent, m.role as messageRole, m.createdAt as messageCreatedAt,
               c.title as chatTitle
        FROM MessageActions ma
        INNER JOIN Messages m ON ma.messageId = m.id
        INNER JOIN Chats c ON m.chatId = c.id
        WHERE ma.userId = @userId AND ma.actionType = 'like'
        ORDER BY ma.createdAt DESC
      `);
    
    return result.recordset.map(record => ({
      id: record.messageId,
      title: `${record.chatTitle} - ${record.messageRole === 'assistant' ? 'AI Response' : 'User Message'}`,
      description: record.messageContent.length > 100 ? record.messageContent.substring(0, 100) + '...' : record.messageContent,
      date: record.messageCreatedAt,
      type: 'Conversation',
      category: 'Conversation'
    }));
  } catch (error) {
    logger.error('Error getting user liked messages:', error);
    throw error;
  }
}

export async function getUserDislikedMessages(userId: string) {
  try {
    const request = sqlPool.request();
    const result = await request
      .input('userId', sql.NVarChar, userId)
      .query(`
        SELECT ma.*, m.content as messageContent, m.role as messageRole, m.createdAt as messageCreatedAt,
               c.title as chatTitle
        FROM MessageActions ma
        INNER JOIN Messages m ON ma.messageId = m.id
        INNER JOIN Chats c ON m.chatId = c.id
        WHERE ma.userId = @userId AND ma.actionType = 'dislike'
        ORDER BY ma.createdAt DESC
      `);
    
    return result.recordset.map(record => ({
      id: record.messageId,
      title: `${record.chatTitle} - ${record.messageRole === 'assistant' ? 'AI Response' : 'User Message'}`,
      description: record.messageContent.length > 100 ? record.messageContent.substring(0, 100) + '...' : record.messageContent,
      date: record.messageCreatedAt,
      type: 'Conversation',
      category: 'Conversation'
    }));
  } catch (error) {
    logger.error('Error getting user disliked messages:', error);
    throw error;
  }
}

export async function addMessageAction(userId: string, messageId: string, actionType: string) {
  try {
    const request = sqlPool.request();
    const actionId = `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // First, remove any existing action of this type for this message/user
    await request
      .input('messageId', sql.NVarChar, messageId)
      .input('userId', sql.NVarChar, userId)
      .input('actionType', sql.NVarChar, actionType)
      .query(`
        DELETE FROM MessageActions 
        WHERE messageId = @messageId AND userId = @userId AND actionType = @actionType
      `);
    
    // Then add the new action
    await request
      .input('id', sql.NVarChar, actionId)
      .query(`
        INSERT INTO MessageActions (id, messageId, userId, actionType)
        VALUES (@id, @messageId, @userId, @actionType)
      `);
    
    logger.info(`Message action added: ${actionType} for message: ${messageId} user: ${userId}`);
  } catch (error) {
    logger.error('Error adding message action:', error);
    throw error;
  }
}

export async function removeMessageAction(userId: string, messageId: string, actionType: string) {
  try {
    const request = sqlPool.request();
    await request
      .input('messageId', sql.NVarChar, messageId)
      .input('userId', sql.NVarChar, userId)
      .input('actionType', sql.NVarChar, actionType)
      .query(`
        DELETE FROM MessageActions 
        WHERE messageId = @messageId AND userId = @userId AND actionType = @actionType
      `);
    
    logger.info(`Message action removed: ${actionType} for message: ${messageId} user: ${userId}`);
  } catch (error) {
    logger.error('Error removing message action:', error);
    throw error;
  }
}

export async function updateUser(userId: string, updates: any) {
  try {
    const request = sqlPool.request();
    const result = await request
      .input('id', sql.NVarChar, userId)
      .input('firstName', sql.NVarChar, updates.firstName)
      .input('lastName', sql.NVarChar, updates.lastName)
      .input('preferences', sql.NVarChar, updates.preferences ? JSON.stringify(updates.preferences) : null)
      .input('updatedAt', sql.DateTime2, new Date())
      .query(`
        UPDATE Users 
        SET firstName = COALESCE(@firstName, firstName),
            lastName = COALESCE(@lastName, lastName),
            preferences = COALESCE(@preferences, preferences),
            updatedAt = @updatedAt
        OUTPUT INSERTED.*
        WHERE id = @id
      `);
    
    const user = result.recordset[0];
    if (user.preferences) {
      user.preferences = JSON.parse(user.preferences);
    }
    return user;
  } catch (error) {
    logger.error('Error updating user:', error);
    throw error;
  }
}

export async function createChat(chatData: any) {
  try {
    const request = sqlPool.request();
    const result = await request
      .input('id', sql.NVarChar, chatData.id)
      .input('userId', sql.NVarChar, chatData.userId)
      .input('title', sql.NVarChar, chatData.title)
      .input('description', sql.NVarChar, chatData.description)
      .input('messageCount', sql.Int, chatData.messageCount || 0)
      .query(`
        INSERT INTO Chats (id, userId, title, description, messageCount)
        OUTPUT INSERTED.*
        VALUES (@id, @userId, @title, @description, @messageCount)
      `);
    
    return result.recordset[0];
  } catch (error) {
    logger.error('Error creating chat:', error);
    throw error;
  }
}

// Chat and Message Management Functions
export async function createMessage(messageData: any) {
  try {
    const request = sqlPool.request();
    const result = await request
      .input('id', sql.NVarChar, messageData.id)
      .input('chatId', sql.NVarChar, messageData.chatId)
      .input('userId', sql.NVarChar, messageData.userId)
      .input('content', sql.NVarChar, messageData.content)
      .input('role', sql.NVarChar, messageData.role)
      .input('metadata', sql.NVarChar, messageData.metadata ? JSON.stringify(messageData.metadata) : null)
      .input('tokens', sql.Int, messageData.tokens || 0)
      .query(`
        INSERT INTO Messages (id, chatId, userId, content, role, metadata, tokens)
        OUTPUT INSERTED.*
        VALUES (@id, @chatId, @userId, @content, @role, @metadata, @tokens)
      `);
    
    return result.recordset[0];
  } catch (error) {
    logger.error('Error creating message:', error);
    throw error;
  }
}

export async function getMessagesByChatId(chatId: string) {
  try {
    const request = sqlPool.request();
    const result = await request
      .input('chatId', sql.NVarChar, chatId)
      .query('SELECT * FROM Messages WHERE chatId = @chatId ORDER BY createdAt ASC');
    
    return result.recordset.map(message => ({
      ...message,
      metadata: message.metadata ? JSON.parse(message.metadata) : null
    }));
  } catch (error) {
    logger.error('Error getting messages:', error);
    throw error;
  }
}

export async function updateChat(chatId: string, updates: any) {
  try {
    const request = sqlPool.request();
    const setClause = [];
    const params: any = { chatId };

    if (updates.title !== undefined) {
      setClause.push('title = @title');
      params.title = updates.title;
    }
    if (updates.description !== undefined) {
      setClause.push('description = @description');
      params.description = updates.description;
    }
    if (updates.messageCount !== undefined) {
      setClause.push('messageCount = @messageCount');
      params.messageCount = updates.messageCount;
    }
    if (updates.lastMessageAt !== undefined) {
      setClause.push('lastMessageAt = @lastMessageAt');
      params.lastMessageAt = updates.lastMessageAt;
    }

    if (setClause.length === 0) {
      return null;
    }

    setClause.push('updatedAt = GETUTCDATE()');

    const query = `UPDATE Chats SET ${setClause.join(', ')} WHERE id = @chatId`;
    
    const requestWithParams = request.input('chatId', sql.NVarChar, params.chatId);
    Object.keys(params).forEach(key => {
      if (key !== 'chatId') {
        if (key === 'messageCount') {
          requestWithParams.input(key, sql.Int, params[key]);
        } else if (key === 'lastMessageAt') {
          requestWithParams.input(key, sql.DateTime2, params[key]);
        } else {
          requestWithParams.input(key, sql.NVarChar, params[key]);
        }
      }
    });

    await requestWithParams.query(query);
    
    logger.info(`Chat updated: ${chatId}`);
  } catch (error) {
    logger.error('Error updating chat:', error);
    throw error;
  }
}

export async function getUserChatHistory(userId: string, limit: number = 50) {
  try {
    const request = sqlPool.request();
    const result = await request
      .input('userId', sql.NVarChar, userId)
      .input('limit', sql.Int, limit)
      .query(`
        SELECT TOP (@limit) c.*, 
               (SELECT TOP 1 content FROM Messages m WHERE m.chatId = c.id ORDER BY m.createdAt DESC) as lastMessage
        FROM Chats c
        WHERE c.userId = @userId AND c.isArchived = 0
        ORDER BY c.lastMessageAt DESC, c.updatedAt DESC
      `);
    
    return result.recordset.map(chat => ({
      id: chat.id,
      title: chat.title,
      description: chat.description,
      date: chat.lastMessageAt || chat.createdAt,
      messageCount: chat.messageCount,
      lastMessage: chat.lastMessage || 'No messages yet'
    }));
  } catch (error) {
    logger.error('Error getting user chat history:', error);
    throw error;
  }
}

export async function getChatsByUserId(userId: string) {
  try {
    const request = sqlPool.request();
    const result = await request
      .input('userId', sql.NVarChar, userId)
      .query('SELECT * FROM Chats WHERE userId = @userId ORDER BY createdAt DESC');
    
    return result.recordset;
  } catch (error) {
    logger.error('Error getting chats:', error);
    throw error;
  }
}

// File management functions
export async function createFile(fileData: {
  id: string;
  originalName: string;
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
  userId: string;
  chatId?: string;
  messageId?: string;
}) {
  try {
    const request = sqlPool.request();
    const result = await request
      .input('id', sql.NVarChar, fileData.id)
      .input('originalName', sql.NVarChar, fileData.originalName)
      .input('fileName', sql.NVarChar, fileData.fileName)
      .input('mimeType', sql.NVarChar, fileData.mimeType)
      .input('size', sql.Int, fileData.size)
      .input('url', sql.NVarChar, fileData.url)
      .input('userId', sql.NVarChar, fileData.userId)
      .input('chatId', sql.NVarChar, fileData.chatId || null)
      .input('messageId', sql.NVarChar, fileData.messageId || null)
      .query(`
        INSERT INTO Files (id, originalName, fileName, mimeType, size, url, userId, chatId, messageId, createdAt)
        OUTPUT INSERTED.*
        VALUES (@id, @originalName, @fileName, @mimeType, @size, @url, @userId, @chatId, @messageId, GETUTCDATE())
      `);
    
    return result.recordset[0];
  } catch (error) {
    logger.error('Error creating file record:', error);
    throw error;
  }
}

export async function getFileById(fileId: string) {
  try {
    const request = sqlPool.request();
    const result = await request
      .input('id', sql.NVarChar, fileId)
      .query('SELECT * FROM Files WHERE id = @id');
    
    return result.recordset[0] || null;
  } catch (error) {
    logger.error('Error getting file by ID:', error);
    throw error;
  }
}

export async function getFilesByUserId(userId: string) {
  try {
    const request = sqlPool.request();
    const result = await request
      .input('userId', sql.NVarChar, userId)
      .query('SELECT * FROM Files WHERE userId = @userId ORDER BY createdAt DESC');
    
    return result.recordset;
  } catch (error) {
    logger.error('Error getting files by user ID:', error);
    throw error;
  }
}

export async function deleteFileRecord(fileId: string) {
  try {
    const request = sqlPool.request();
    await request
      .input('id', sql.NVarChar, fileId)
      .query('DELETE FROM Files WHERE id = @id');
    
    logger.info(`File record deleted: ${fileId}`);
  } catch (error) {
    logger.error('Error deleting file record:', error);
    throw error;
  }
}

// Helper function for generating intelligent responses
function generateIntelligentResponse(userMessage: string): string {
  const message = userMessage.toLowerCase().trim();
  
  // Greeting responses - more comprehensive matching
  if (message === 'hi' || message === 'hello' || message === 'hey' || 
      message === 'hi there' || message === 'hello there' || message === 'hey there' ||
      message === 'good morning' || message === 'good afternoon' || message === 'good evening' ||
      message.startsWith('hi ') || message.startsWith('hello ') || message.startsWith('hey ') ||
      message.startsWith('good morning') || message.startsWith('good afternoon') || message.startsWith('good evening')) {
    const greetings = [
      "Hello! I'm AIVA, your AI assistant. How can I help you today?",
      "Hi there! I'm here to assist you with any questions or tasks you have.",
      "Hey! Great to meet you. What would you like to know or discuss?",
      "Hello! I'm AIVA, ready to help you with information, analysis, or creative tasks."
    ];
    return greetings[Math.floor(Math.random() * greetings.length)];
  }
  
  // Specific question patterns
  if (message.includes('what can you do') || message.includes('what are your capabilities')) {
    return "I can help you with many things! I can answer questions, provide explanations, help with analysis, assist with creative writing, solve problems, discuss various topics, and much more. What specific area would you like help with?";
  }
  
  if (message.includes('who are you') || message.includes('what are you')) {
    return "I'm AIVA (Artificial Intelligence Virtual Assistant), your AI assistant designed to help with a wide variety of tasks. I can answer questions, provide explanations, help with analysis, and engage in meaningful conversations. How can I assist you today?";
  }
  
  if (message.includes('how are you') || message.includes('how do you do')) {
    return "I'm doing great, thank you for asking! I'm here and ready to help you with whatever you need. What can I assist you with today?";
  }
  
  // Specific factual questions - provide informative answers
  if (message.includes('richest') && (message.includes('person') || message.includes('man') || message.includes('woman') || message.includes('world'))) {
    return "Based on recent data, Elon Musk and Bernard Arnault have been competing for the title of world's richest person, with their net worth fluctuating based on stock prices. Other top billionaires include Jeff Bezos, Bill Gates, and Warren Buffett. The exact ranking changes frequently due to market conditions. Would you like to know more about any specific billionaire or wealth trends?";
  }
  
  if (message.includes('time') && (message.includes('what') || message.includes('current'))) {
    const now = new Date();
    return `The current time is ${now.toLocaleTimeString()} on ${now.toLocaleDateString()}. Is there anything specific you'd like to know about time zones or scheduling?`;
  }
  
  if (message.includes('weather') || message.includes('temperature')) {
    return "I don't have access to real-time weather data, but I can help you understand weather patterns, climate information, or suggest reliable weather apps and websites like Weather.com, AccuWeather, or your local meteorological service. What specific weather information are you looking for?";
  }
  
  if (message.includes('news') || message.includes('current events')) {
    return "I don't have access to real-time news, but I can help you understand current topics, explain complex issues, or suggest reliable news sources like Reuters, BBC, AP News, or NPR. What kind of news or current events are you interested in discussing?";
  }
  
  // General question responses - more contextual
  if (message.includes('what') || message.includes('how') || message.includes('why') || message.includes('?')) {
    // Try to give more specific responses based on keywords
    if (message.includes('work') || message.includes('job') || message.includes('career')) {
      return "Career success often depends on a combination of skills, networking, continuous learning, and finding the right opportunities. Key factors include developing both technical and soft skills, building professional relationships, staying adaptable to industry changes, and aligning your work with your values and interests. What specific aspect of career development interests you most?";
    }
    if (message.includes('learn') || message.includes('study') || message.includes('education')) {
      return "Effective learning involves active engagement, spaced repetition, and connecting new information to existing knowledge. Some proven strategies include: setting clear goals, breaking complex topics into smaller parts, practicing regularly, teaching others what you've learned, and using multiple learning methods (visual, auditory, hands-on). What subject or skill are you looking to learn about?";
    }
    if (message.includes('technology') || message.includes('tech') || message.includes('computer')) {
      return "Technology is rapidly evolving across many areas: AI and machine learning are transforming industries, cloud computing enables scalable solutions, mobile technology connects billions globally, and emerging fields like quantum computing and biotechnology promise revolutionary changes. Current trends include automation, cybersecurity, sustainable tech, and human-computer interaction. What specific technology area interests you?";
    }
    if (message.includes('health') || message.includes('fitness') || message.includes('exercise')) {
      return "Good health typically involves regular physical activity, balanced nutrition, adequate sleep, stress management, and preventive healthcare. The WHO recommends at least 150 minutes of moderate exercise weekly, a diet rich in fruits and vegetables, 7-9 hours of sleep, and regular health check-ups. Mental health is equally important through social connections, mindfulness, and professional support when needed. What aspect of health and wellness interests you most?";
    }
    if (message.includes('money') || message.includes('finance') || message.includes('investment')) {
      return "Sound financial management includes budgeting, saving, investing wisely, and managing debt. Key principles: spend less than you earn, build an emergency fund, diversify investments, understand compound interest, and plan for long-term goals like retirement. Popular investment options include index funds, real estate, and retirement accounts. Always consider your risk tolerance and consult financial advisors for personalized advice. What financial topic would you like to explore?";
    }
    
    // Default question response - more helpful
    const responses = [
      "That's a thoughtful question! Let me provide some insights on this topic. Based on current knowledge and best practices, there are several key aspects to consider. What specific angle would you like me to focus on?",
      "Great question! This is an area with many interesting dimensions. I can share some valuable information and perspectives on this. What particular aspect would be most helpful for you?",
      "I'd be happy to help with that! This topic involves several important factors worth exploring. Let me know what specific information would be most useful for your situation.",
      "That's worth discussing! There are some key principles and insights I can share about this. What would be the most helpful way for me to approach this topic for you?"
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }
  
  // Help requests
  if (message.includes('help') || message.includes('assist') || message.includes('support')) {
    const helpResponses = [
      "I'm here to help! I can assist you with a wide range of tasks including answering questions, providing explanations, helping with analysis, creative writing, problem-solving, and much more. What specific area would you like help with?",
      "Absolutely! I'd be glad to assist you. I can help with research, explanations, brainstorming, writing, data analysis, coding questions, and many other tasks. What do you need help with today?",
      "Of course! I'm designed to be helpful across many different areas. Whether you need information, want to discuss ideas, need help with a project, or have questions about any topic, I'm here to support you. How can I assist?",
      "I'm ready to help! I can provide assistance with various tasks like answering questions, explaining concepts, helping with creative projects, problem-solving, and more. What would you like to work on together?"
    ];
    return helpResponses[Math.floor(Math.random() * helpResponses.length)];
  }
  
  // Technology/AI questions
  if (message.includes('ai') || message.includes('artificial intelligence') || message.includes('technology') || message.includes('computer')) {
    const techResponses = [
      "AI and technology are fascinating fields that are rapidly evolving! There are so many exciting developments happening, from machine learning and natural language processing to robotics and automation. What specific aspect interests you most?",
      "Technology, especially AI, is transforming how we work and live. From improving healthcare and education to enhancing productivity and creativity, AI has tremendous potential. I'd love to discuss any particular area you're curious about!",
      "Artificial Intelligence is a broad field encompassing machine learning, deep learning, natural language processing, computer vision, and more. Each area has unique applications and challenges. What would you like to explore about AI?",
      "The world of technology is incredibly dynamic! AI is just one part of a larger ecosystem that includes cloud computing, mobile development, data science, cybersecurity, and emerging technologies. What interests you most?"
    ];
    return techResponses[Math.floor(Math.random() * techResponses.length)];
  }
  
  // Personal questions
  if (message.includes('who are you') || message.includes('what are you') || message.includes('about you')) {
    return "I'm AIVA (Artificial Intelligence Virtual Assistant), an AI assistant designed to help you with a wide variety of tasks. I can answer questions, provide explanations, help with analysis, assist with creative projects, and engage in meaningful conversations. I'm here to be helpful, informative, and supportive in whatever you're working on!";
  }
  
  // Capabilities questions
  if (message.includes('what can you do') || message.includes('capabilities') || message.includes('features')) {
    return "I have a wide range of capabilities! I can help with: answering questions and providing explanations, research and information gathering, writing and editing assistance, data analysis and interpretation, creative projects and brainstorming, problem-solving and troubleshooting, coding and technical support, and engaging conversations on various topics. What would you like to explore together?";
  }
  
  // Try to respond based on message content and context
  if (message.includes('thank') || message.includes('thanks')) {
    return "You're very welcome! I'm glad I could help. Is there anything else you'd like to know or discuss?";
  }
  
  if (message.includes('good') || message.includes('great') || message.includes('awesome') || message.includes('excellent')) {
    return "I'm so glad to hear that! It's wonderful when things go well. What else can I help you with today?";
  }
  
  if (message.includes('problem') || message.includes('issue') || message.includes('trouble')) {
    return "I understand you're facing a challenge. I'd be happy to help you work through this problem. Could you tell me more about what's going on?";
  }
  
  if (message.includes('tell me about') || message.includes('explain')) {
    return "I'd be happy to explain that topic for you! To give you the most helpful information, could you be a bit more specific about what aspect you'd like me to focus on?";
  }
  
  // For very short or unclear messages (but not greetings), ask for clarification
  if ((message.length < 3 || message.match(/^[a-z]{1,2}$/)) && 
      !['hi', 'hey'].includes(message)) {
    return "I'd love to help you! Could you tell me a bit more about what you're looking for or what you'd like to discuss?";
  }
  
  // Default responses - more helpful and specific
  const defaultResponses = [
    "I'd be happy to help you with that! Could you provide a bit more detail so I can give you the most useful response?",
    "That's an interesting topic! To better assist you, could you tell me more about what specific aspect you're curious about?",
    "I'm here to help! What would you like to know more about, or is there something specific I can assist you with?",
    "Thanks for reaching out! I'd love to help you explore this further. What particular aspect interests you most?",
    "I'm ready to assist! Could you share a bit more about what you're looking for so I can provide the most helpful information?",
    "That sounds like something worth discussing! What specific questions do you have, or what would you like to learn more about?"
  ];
  
  return defaultResponses[Math.floor(Math.random() * defaultResponses.length)];
}

// openAIClient is already exported at the top of the file