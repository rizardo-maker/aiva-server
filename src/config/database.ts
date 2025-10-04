import * as sql from 'mssql';
import { logger } from '../utils/logger';

export interface DatabaseConfig {
  server: string;
  database: string;
  user: string;
  password: string;
  options: {
    encrypt: boolean;
    trustServerCertificate: boolean;
    enableArithAbort: boolean;
    requestTimeout: number;
    connectionTimeout: number;
  };
  pool: {
    max: number;
    min: number;
    idleTimeoutMillis: number;
    acquireTimeoutMillis: number;
  };
}

export const getDatabaseConfig = async (): Promise<DatabaseConfig> => {
  // Use environment variables directly for database configuration
  // This bypasses Key Vault which might have authentication issues
  const mergedConfig: Record<string, string> = {};
  
  // Define the required config keys
  const requiredConfigKeys = ['SQL_SERVER', 'SQL_DATABASE', 'SQL_USERNAME', 'SQL_PASSWORD'];
  
  // Get configuration values from environment variables
  for (const key of requiredConfigKeys) {
    mergedConfig[key] = process.env[key] || '';
  }
  
  // Add optional config keys
  mergedConfig['SQL_ENCRYPT'] = process.env['SQL_ENCRYPT'] || 'true';
  mergedConfig['SQL_TRUST_SERVER_CERTIFICATE'] = process.env['SQL_TRUST_SERVER_CERTIFICATE'] || 'false';
  mergedConfig['SQL_REQUEST_TIMEOUT'] = process.env['SQL_REQUEST_TIMEOUT'] || '30000';
  mergedConfig['SQL_CONNECTION_TIMEOUT'] = process.env['SQL_CONNECTION_TIMEOUT'] || '15000';
  mergedConfig['SQL_POOL_MAX'] = process.env['SQL_POOL_MAX'] || '10';
  mergedConfig['SQL_POOL_MIN'] = process.env['SQL_POOL_MIN'] || '0';
  mergedConfig['SQL_POOL_IDLE_TIMEOUT'] = process.env['SQL_POOL_IDLE_TIMEOUT'] || '30000';
  mergedConfig['SQL_POOL_ACQUIRE_TIMEOUT'] = process.env['SQL_POOL_ACQUIRE_TIMEOUT'] || '60000';
  
  // Check for missing required keys
  const missingKeys = requiredConfigKeys.filter(key => !mergedConfig[key]);
  
  if (missingKeys.length > 0) {
    throw new Error(`Missing required database configuration keys: ${missingKeys.join(', ')}`);
  }
  
  // Log the source of database configuration
  logger.info('Database configuration loaded from environment variables');

  return {
    server: mergedConfig.SQL_SERVER,
    database: mergedConfig.SQL_DATABASE,
    user: mergedConfig.SQL_USERNAME,
    password: mergedConfig.SQL_PASSWORD,
    options: {
      encrypt: mergedConfig.SQL_ENCRYPT === 'true',
      trustServerCertificate: mergedConfig.SQL_TRUST_SERVER_CERTIFICATE === 'true',
      enableArithAbort: true,
      requestTimeout: parseInt(mergedConfig.SQL_REQUEST_TIMEOUT),
      connectionTimeout: parseInt(mergedConfig.SQL_CONNECTION_TIMEOUT),
    },
    pool: {
      max: parseInt(mergedConfig.SQL_POOL_MAX),
      min: parseInt(mergedConfig.SQL_POOL_MIN),
      idleTimeoutMillis: parseInt(mergedConfig.SQL_POOL_IDLE_TIMEOUT),
      acquireTimeoutMillis: parseInt(mergedConfig.SQL_POOL_ACQUIRE_TIMEOUT),
    }
  };
};

export class DatabaseManager {
  private static instance: DatabaseManager;
  private pool: sql.ConnectionPool | null = null;
  private isConnecting = false;
  private config: DatabaseConfig | null = null;

  private constructor() {}

  public static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  public async connect(): Promise<sql.ConnectionPool> {
    if (this.pool && this.pool.connected) {
      return this.pool;
    }

    if (this.isConnecting) {
      // Wait for existing connection attempt
      while (this.isConnecting) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (this.pool && this.pool.connected) {
        return this.pool;
      }
    }

    this.isConnecting = true;

    try {
      // Check if we should use mock database
      const mockDatabase = process.env.MOCK_SQL === 'true' || process.env.MOCK_DATABASE === 'true';
      const nodeEnv = process.env.NODE_ENV || 'development';
      
      if (mockDatabase) {
        logger.info('Using mock SQL database connection');
        // Create a mock SQL pool with the necessary methods
        const mockUsers = [
          {
            id: 'admin1',
            firstName: 'Sudhen',
            lastName: 'Reddy',
            email: 'sudhenreddym@gmail.com',
            password: '$2a$12$ROOi78DCIejcsRDBpCA/AutzaiYNkg25adtn6kDREkIMLEdkDs0A.', // admin123
            provider: 'local',
            role: 'admin',
            isActive: true,
            lastLoginAt: null,
            createdAt: new Date(),
            updatedAt: new Date()
          }
        ];
        
        const mockWorkspaces = [
          {
            id: '550e8400-e29b-41d4-a716-446655440001',
            name: 'Legal',
            description: 'Legal department workspace',
            color: '#3B82F6',
            isShared: true,
            ownerId: 'admin1',
            createdAt: new Date(),
            updatedAt: new Date()
          },
          {
            id: '550e8400-e29b-41d4-a716-446655440002',
            name: 'Marketing',
            description: 'Marketing team workspace',
            color: '#10B981',
            isShared: true,
            ownerId: 'admin1',
            createdAt: new Date(),
            updatedAt: new Date()
          },
          {
            id: '550e8400-e29b-41d4-a716-446655440003',
            name: 'Development',
            description: 'Development team workspace',
            color: '#F59E0B',
            isShared: false,
            ownerId: 'admin1',
            createdAt: new Date(),
            updatedAt: new Date()
          }
        ];
        
        const mockChats = [
          {
            id: 'chat1',
            userId: 'user1',
            title: 'Welcome Chat',
            description: 'Your first conversation',
            messageCount: 2,
            isArchived: false,
            lastMessageAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date()
          }
        ];
        
        const mockMessages = [
          {
            id: 'msg1',
            chatId: 'chat1',
            userId: 'user1',
            content: 'Hello! How can I help you today?',
            role: 'user',
            tokens: 10,
            createdAt: new Date()
          },
          {
            id: 'msg2',
            chatId: 'chat1',
            userId: 'user1',
            content: 'Hello! I\'m AIVA, your AI assistant. I\'m here to help you with any questions or tasks you might have.',
            role: 'assistant',
            tokens: 25,
            createdAt: new Date()
          }
        ];
        
        const mockMessageActions = [
          {
            id: 'action1',
            messageId: 'msg2',
            userId: 'user1',
            actionType: 'like',
            createdAt: new Date()
          }
        ];
        
        const mockFeedback = [
          {
            id: 'feedback1',
            userId: 'user1',
            subject: 'Great service!',
            message: 'AIVA is very helpful and responsive.',
            category: 'compliment',
            priority: 'medium',
            status: 'open',
            createdAt: new Date(),
            updatedAt: new Date()
          }
        ];
        
        // Store parameters for the current request
        let requestParams: any = {};
        
        this.pool = {
          request: () => {
            // Reset parameters for new request
            requestParams = {};
            
            const mockRequest: any = {
              input: function(name: string, type?: any, value?: any) {
                // Handle both 2 and 3 parameter versions
                const actualValue = arguments.length === 2 ? type : value;
                requestParams[name] = actualValue;
                return this;
              },
              query: async (queryStr: string) => {
                // Mock database responses based on query type
                if (queryStr.includes('SELECT * FROM Users WHERE email =')) {
                  const email = requestParams.email;
                  return { recordset: email ? mockUsers.filter(u => u.email === email) : [] };
                }
                
                if (queryStr.includes('SELECT * FROM Users WHERE id =') || queryStr.includes('SELECT id, email FROM Users WHERE id =')) {
                  const id = requestParams.id;
                  return { recordset: id ? mockUsers.filter(u => u.id === id) : [] };
                }
                
                // Handle admin users query with JOINs and GROUP BY
                if (queryStr.includes('SELECT') && queryStr.includes('FROM Users u') && queryStr.includes('LEFT JOIN')) {
                  // Return all users with additional fields for admin interface
                  const usersWithStats = mockUsers.map(user => ({
                    ...user,
                    chatCount: 0,
                    messageCount: 0,
                    lastLogin: user.lastLoginAt || null
                  }));
                  return { recordset: usersWithStats };
                }
                
                // Handle simple user count query
                if (queryStr.includes('SELECT COUNT(*) as total FROM Users')) {
                  return { recordset: [{ total: mockUsers.length }] };
                }
                
                // Handle workspace count query
                if (queryStr.includes('SELECT COUNT(*) as total FROM Workspaces')) {
                  const ownerId = requestParams.userId;
                  const count = mockWorkspaces.filter(w => w.ownerId === ownerId).length;
                  return { recordset: [{ total: count }] };
                }
                
                if (queryStr.includes('INSERT INTO Users')) {
                  const newUser = {
                    id: requestParams.id || `user${Date.now()}`,
                    firstName: requestParams.firstName || 'New',
                    lastName: requestParams.lastName || 'User',
                    email: requestParams.email || 'new@example.com',
                    password: requestParams.password || '',
                    provider: requestParams.provider || 'local',
                    role: requestParams.role || 'user',
                    isActive: true,
                    lastLoginAt: null,
                    createdAt: new Date(),
                    updatedAt: new Date()
                  };
                  mockUsers.push(newUser);
                  return { recordset: [newUser] };
                }
                
                if (queryStr.includes('UPDATE Users SET lastLoginAt')) {
                  return { recordset: [] };
                }
                
                // Handle user deletion
                if (queryStr.includes('DELETE FROM Users WHERE id =')) {
                  const userId = requestParams.id;
                  const userIndex = mockUsers.findIndex(u => u.id === userId);
                  if (userIndex !== -1) {
                    mockUsers.splice(userIndex, 1);
                    return { recordset: [] };
                  }
                  return { recordset: [] };
                }
                
                // Handle workspace queries
                if (queryStr.includes('SELECT id FROM Workspaces WHERE id =')) {
                  const workspaceId = requestParams.workspaceId;
                  const ownerId = requestParams.ownerId;
                  // Check if workspace exists and user owns it
                  const workspace = mockWorkspaces.find(w => w.id === workspaceId && w.ownerId === ownerId);
                  if (workspace) {
                    return { recordset: [{ id: workspaceId }] };
                  }
                  return { recordset: [] };
                }
                
                // Handle workspace listing queries
                if (queryStr.includes('FROM Workspaces w') && queryStr.includes('WHERE w.ownerId')) {
                  const ownerId = requestParams.userId;
                  const userWorkspaces = mockWorkspaces
                    .filter(w => w.ownerId === ownerId)
                    .map(w => ({
                      ...w,
                      chatCount: 0,
                      lastActivity: null
                    }));
                  return { recordset: userWorkspaces };
                }
                
                // Handle available users query for workspace assignment
                if (queryStr.includes('LEFT JOIN WorkspaceUsers wu ON u.id = wu.userId')) {
                  // Return all non-admin users for workspace assignment
                  const availableUsers = mockUsers
                    .filter(user => user.role !== 'admin')
                    .map(user => ({
                      ...user,
                      isAssigned: 0, // Not assigned by default
                      accessLevel: null,
                      assignedAt: null
                    }));
                  return { recordset: availableUsers };
                }
                
                // Handle workspace user assignment
                if (queryStr.includes('INSERT INTO WorkspaceUsers')) {
                  // Mock successful assignment
                  return { recordset: [] };
                }
                
                // Handle workspace user check
                if (queryStr.includes('SELECT userId FROM WorkspaceUsers WHERE')) {
                  // Mock no existing assignment
                  return { recordset: [] };
                }
                
                if (queryStr.includes('SELECT TOP') && queryStr.includes('FROM Chats')) {
                  const userId = requestParams.userId;
                  return { recordset: userId ? mockChats.filter(c => c.userId === userId) : mockChats };
                }
                
                if (queryStr.includes('INSERT INTO Chats')) {
                  const newChat = {
                    id: requestParams.id || `chat${Date.now()}`,
                    userId: requestParams.userId || 'user1',
                    title: requestParams.title || 'New Chat',
                    description: requestParams.description || '',
                    messageCount: 0,
                    isArchived: false,
                    lastMessageAt: new Date(),
                    createdAt: new Date(),
                    updatedAt: new Date()
                  };
                  mockChats.push(newChat);
                  return { recordset: [newChat] };
                }
                
                if (queryStr.includes('FROM Messages')) {
                  if (queryStr.includes('chatId =')) {
                    const chatId = requestParams.chatId;
                    return { recordset: chatId ? mockMessages.filter(m => m.chatId === chatId) : [] };
                  }
                  return { recordset: mockMessages };
                }
                
                if (queryStr.includes('INSERT INTO Messages')) {
                  const newMessage = {
                    id: requestParams.id || `msg${Date.now()}`,
                    chatId: requestParams.chatId || 'chat1',
                    userId: requestParams.userId || 'user1',
                    content: requestParams.content || '',
                    role: requestParams.role || 'user',
                    tokens: requestParams.tokens || 0,
                    metadata: requestParams.metadata || null,
                    createdAt: new Date()
                  };
                  mockMessages.push(newMessage);
                  return { recordset: [newMessage] };
                }
                
                if (queryStr.includes('FROM MessageActions')) {
                  const userId = requestParams.userId;
                  if (queryStr.includes('actionType = \'like\'')) {
                    return { recordset: userId ? mockMessageActions.filter(ma => ma.actionType === 'like' && ma.userId === userId) : [] };
                  }
                  if (queryStr.includes('actionType = \'dislike\'')) {
                    return { recordset: userId ? mockMessageActions.filter(ma => ma.actionType === 'dislike' && ma.userId === userId) : [] };
                  }
                  if (queryStr.includes('actionType = \'bookmark\'')) {
                    return { recordset: userId ? mockMessageActions.filter(ma => ma.actionType === 'bookmark' && ma.userId === userId) : [] };
                  }
                  return { recordset: mockMessageActions };
                }
                
                if (queryStr.includes('INSERT INTO MessageActions')) {
                  const newAction = {
                    id: requestParams.id || `action${Date.now()}`,
                    messageId: requestParams.messageId || '',
                    userId: requestParams.userId || '',
                    actionType: requestParams.actionType || 'like',
                    createdAt: new Date()
                  };
                  mockMessageActions.push(newAction);
                  return { recordset: [newAction] };
                }
                
                if (queryStr.includes('DELETE FROM MessageActions')) {
                  return { recordset: [] };
                }
                
                if (queryStr.includes('FROM Feedback')) {
                  const userId = requestParams.userId;
                  return { recordset: userId ? mockFeedback.filter(f => f.userId === userId) : mockFeedback };
                }
                
                if (queryStr.includes('INSERT INTO Feedback')) {
                  const newFeedback = {
                    id: requestParams.id || `feedback${Date.now()}`,
                    userId: requestParams.userId || '',
                    subject: requestParams.subject || '',
                    message: requestParams.message || '',
                    category: requestParams.category || 'general',
                    priority: requestParams.priority || 'medium',
                    status: 'open',
                    createdAt: new Date(),
                    updatedAt: new Date()
                  };
                  mockFeedback.push(newFeedback);
                  return { recordset: [newFeedback] };
                }
                
                if (queryStr.includes('UPDATE') || queryStr.includes('DELETE')) {
                  return { recordset: [] };
                }
                
                if (queryStr.includes('COUNT(*)')) {
                  return { recordset: [{ total: 1 }] };
                }
                
                return { recordset: [] };
              }
            };
            
            return mockRequest;
          },
          query: async () => ({ recordset: [] }),
          connected: true,
          connect: async () => ({}),
          close: async () => ({})
        } as unknown as sql.ConnectionPool;
        
        return this.pool;
      }
      
      // Get database config from Key Vault via ConfigurationManager
      this.config = await getDatabaseConfig();
      this.pool = new sql.ConnectionPool(this.config);
      
      this.pool.on('error', (err) => {
        logger.error('Database pool error:', err);
        this.pool = null;
      });

      await this.pool.connect();
      logger.info('✅ Database connected successfully');
      
      // Initialize database schema
      await this.initializeSchema();
      
      return this.pool;
    } catch (error) {
      logger.error('❌ Database connection failed:', error);
      this.pool = null;
      throw error;
    } finally {
      this.isConnecting = false;
    }
  }

  public async getPool(): Promise<sql.ConnectionPool> {
    if (!this.pool || !this.pool.connected) {
      return await this.connect();
    }
    return this.pool;
  }

  public async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.close();
      this.pool = null;
      logger.info('Database disconnected');
    }
  }

  public async reinitialize(): Promise<void> {
    try {
      logger.info('Reinitializing database connection with new configuration...');
      await this.disconnect();
      await this.connect();
      logger.info('✅ Database connection reinitialized successfully');
    } catch (error) {
      logger.error('Failed to reinitialize database connection:', error);
      throw error;
    }
  }

  private async initializeSchema(): Promise<void> {
    if (!this.pool) throw new Error('Database not connected');

    try {
      // Create Users table
      await this.pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Users' AND xtype='U')
        CREATE TABLE Users (
          id NVARCHAR(255) PRIMARY KEY,
          firstName NVARCHAR(100) NOT NULL,
          lastName NVARCHAR(100) NOT NULL,
          email NVARCHAR(255) UNIQUE NOT NULL,
          password NVARCHAR(255),
          provider NVARCHAR(50) NOT NULL DEFAULT 'local',
          providerId NVARCHAR(255),
          avatar NVARCHAR(500),
          preferences NVARCHAR(MAX),
          role NVARCHAR(50) DEFAULT 'user' CHECK (role IN ('admin', 'user')),
          isActive BIT DEFAULT 1,
          lastLoginAt DATETIME2,
          createdAt DATETIME2 DEFAULT GETUTCDATE(),
          updatedAt DATETIME2 DEFAULT GETUTCDATE()
        )
      `);

      // Add role column to existing Users table if it doesn't exist
      await this.pool.request().query(`
        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Users' AND COLUMN_NAME = 'role')
        ALTER TABLE Users ADD role NVARCHAR(50) DEFAULT 'user' CHECK (role IN ('admin', 'user'))
      `);

      // Create Workspaces table
      await this.pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Workspaces' AND xtype='U')
        CREATE TABLE Workspaces (
          id NVARCHAR(255) PRIMARY KEY,
          name NVARCHAR(200) NOT NULL,
          description NVARCHAR(1000),
          color NVARCHAR(7) DEFAULT '#3B82F6',
          isShared BIT DEFAULT 0,
          ownerId NVARCHAR(255) NOT NULL,
          createdAt DATETIME2 DEFAULT GETUTCDATE(),
          updatedAt DATETIME2 DEFAULT GETUTCDATE(),
          FOREIGN KEY (ownerId) REFERENCES Users(id)
        )
      `);

      // Create Chats table
      await this.pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Chats' AND xtype='U')
        CREATE TABLE Chats (
          id NVARCHAR(255) PRIMARY KEY,
          title NVARCHAR(500) NOT NULL,
          description NVARCHAR(1000),
          userId NVARCHAR(255) NOT NULL,
          workspaceId NVARCHAR(255),
          messageCount INT DEFAULT 0,
          isArchived BIT DEFAULT 0,
          lastMessageAt DATETIME2,
          createdAt DATETIME2 DEFAULT GETUTCDATE(),
          updatedAt DATETIME2 DEFAULT GETUTCDATE(),
          FOREIGN KEY (userId) REFERENCES Users(id),
          FOREIGN KEY (workspaceId) REFERENCES Workspaces(id)
        )
      `);

      // Create Messages table
      await this.pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Messages' AND xtype='U')
        CREATE TABLE Messages (
          id NVARCHAR(255) PRIMARY KEY,
          chatId NVARCHAR(255) NOT NULL,
          userId NVARCHAR(255) NOT NULL,
          content NVARCHAR(MAX) NOT NULL,
          role NVARCHAR(50) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
          metadata NVARCHAR(MAX),
          tokens INT DEFAULT 0,
          isEdited BIT DEFAULT 0,
          editedAt DATETIME2,
          createdAt DATETIME2 DEFAULT GETUTCDATE(),
          FOREIGN KEY (chatId) REFERENCES Chats(id),
          FOREIGN KEY (userId) REFERENCES Users(id)
        )
      `);

      // Create MessageActions table for likes, bookmarks, etc.
      await this.pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='MessageActions' AND xtype='U')
        CREATE TABLE MessageActions (
          id NVARCHAR(255) PRIMARY KEY,
          messageId NVARCHAR(255) NOT NULL,
          userId NVARCHAR(255) NOT NULL,
          actionType NVARCHAR(50) NOT NULL CHECK (actionType IN ('like', 'dislike', 'bookmark', 'star')),
          createdAt DATETIME2 DEFAULT GETUTCDATE(),
          FOREIGN KEY (messageId) REFERENCES Messages(id),
          FOREIGN KEY (userId) REFERENCES Users(id),
          UNIQUE(messageId, userId, actionType)
        )
      `);

      // Create Files table
      await this.pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Files' AND xtype='U')
        CREATE TABLE Files (
          id NVARCHAR(255) PRIMARY KEY,
          originalName NVARCHAR(500) NOT NULL,
          fileName NVARCHAR(500) NOT NULL,
          mimeType NVARCHAR(200) NOT NULL,
          size BIGINT NOT NULL,
          url NVARCHAR(1000) NOT NULL,
          userId NVARCHAR(255) NOT NULL,
          chatId NVARCHAR(255),
          messageId NVARCHAR(255),
          createdAt DATETIME2 DEFAULT GETUTCDATE(),
          FOREIGN KEY (userId) REFERENCES Users(id),
          FOREIGN KEY (chatId) REFERENCES Chats(id),
          FOREIGN KEY (messageId) REFERENCES Messages(id)
        )
      `);

      // Create Sessions table for user sessions
      await this.pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Sessions' AND xtype='U')
        CREATE TABLE Sessions (
          id NVARCHAR(255) PRIMARY KEY,
          userId NVARCHAR(255) NOT NULL,
          token NVARCHAR(500) NOT NULL,
          refreshToken NVARCHAR(500),
          expiresAt DATETIME2 NOT NULL,
          isActive BIT DEFAULT 1,
          userAgent NVARCHAR(1000),
          ipAddress NVARCHAR(45),
          createdAt DATETIME2 DEFAULT GETUTCDATE(),
          FOREIGN KEY (userId) REFERENCES Users(id)
        )
      `);

      // Create WorkspaceUsers table for user-workspace assignments
      await this.pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='WorkspaceUsers' AND xtype='U')
        CREATE TABLE WorkspaceUsers (
          id NVARCHAR(255) PRIMARY KEY,
          workspaceId NVARCHAR(255) NOT NULL,
          userId NVARCHAR(255) NOT NULL,
          accessLevel NVARCHAR(50) DEFAULT 'member' CHECK (accessLevel IN ('owner', 'admin', 'member', 'readonly')),
          assignedBy NVARCHAR(255),
          assignedAt DATETIME2 DEFAULT GETUTCDATE(),
          FOREIGN KEY (workspaceId) REFERENCES Workspaces(id),
          FOREIGN KEY (userId) REFERENCES Users(id),
          FOREIGN KEY (assignedBy) REFERENCES Users(id),
          UNIQUE(workspaceId, userId)
        )
      `);

      // Create AuditLogs table
      await this.pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='AuditLogs' AND xtype='U')
        CREATE TABLE AuditLogs (
          id NVARCHAR(255) PRIMARY KEY,
          userId NVARCHAR(255),
          action NVARCHAR(100) NOT NULL,
          resource NVARCHAR(100) NOT NULL,
          resourceId NVARCHAR(255),
          details NVARCHAR(MAX),
          ipAddress NVARCHAR(45),
          userAgent NVARCHAR(1000),
          createdAt DATETIME2 DEFAULT GETUTCDATE(),
          FOREIGN KEY (userId) REFERENCES Users(id) ON DELETE SET NULL
        )
      `);

      // Create DatabaseConnections table
      await this.pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='DatabaseConnections' AND xtype='U')
        CREATE TABLE DatabaseConnections (
          id NVARCHAR(255) PRIMARY KEY,
          userId NVARCHAR(255) NOT NULL,
          name NVARCHAR(200) NOT NULL,
          type NVARCHAR(50) NOT NULL CHECK (type IN ('fabric', 'sql-server', 'mysql', 'postgresql', 'oracle', 'mongodb')),
          host NVARCHAR(500) NOT NULL,
          port INT NOT NULL,
          databaseName NVARCHAR(200),
          username NVARCHAR(200),
          password NVARCHAR(500), -- In production, this should be encrypted
          status NVARCHAR(50) DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'error')),
          isDefault BIT DEFAULT 0,
          lastConnected DATETIME2,
          createdAt DATETIME2 DEFAULT GETUTCDATE(),
          updatedAt DATETIME2 DEFAULT GETUTCDATE(),
          FOREIGN KEY (userId) REFERENCES Users(id)
        )
      `);

      // Create Feedback table
      await this.pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Feedback' AND xtype='U')
        CREATE TABLE Feedback (
          id NVARCHAR(255) PRIMARY KEY,
          userId NVARCHAR(255) NOT NULL,
          subject NVARCHAR(500) NOT NULL,
          message NVARCHAR(MAX) NOT NULL,
          category NVARCHAR(100) NOT NULL CHECK (category IN ('bug', 'feature', 'improvement', 'general', 'complaint', 'compliment')),
          priority NVARCHAR(50) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
          status NVARCHAR(50) DEFAULT 'open' CHECK (status IN ('open', 'in-progress', 'resolved', 'closed')),
          adminResponse NVARCHAR(MAX),
          adminId NVARCHAR(255),
          respondedAt DATETIME2,
          createdAt DATETIME2 DEFAULT GETUTCDATE(),
          updatedAt DATETIME2 DEFAULT GETUTCDATE(),
          FOREIGN KEY (userId) REFERENCES Users(id),
          FOREIGN KEY (adminId) REFERENCES Users(id)
        )
      `);

      // Create indexes for better performance
      const indexes = [
        'CREATE INDEX IF NOT EXISTS IX_Users_Email ON Users(email)',
        'CREATE INDEX IF NOT EXISTS IX_Users_Provider ON Users(provider, providerId)',
        'CREATE INDEX IF NOT EXISTS IX_Chats_UserId ON Chats(userId)',
        'CREATE INDEX IF NOT EXISTS IX_Chats_WorkspaceId ON Chats(workspaceId)',
        'CREATE INDEX IF NOT EXISTS IX_Chats_LastMessageAt ON Chats(lastMessageAt DESC)',
        'CREATE INDEX IF NOT EXISTS IX_Messages_ChatId ON Messages(chatId)',
        'CREATE INDEX IF NOT EXISTS IX_Messages_UserId ON Messages(userId)',
        'CREATE INDEX IF NOT EXISTS IX_Messages_CreatedAt ON Messages(createdAt DESC)',
        'CREATE INDEX IF NOT EXISTS IX_MessageActions_MessageId ON MessageActions(messageId)',
        'CREATE INDEX IF NOT EXISTS IX_MessageActions_UserId ON MessageActions(userId)',
        'CREATE INDEX IF NOT EXISTS IX_Files_UserId ON Files(userId)',
        'CREATE INDEX IF NOT EXISTS IX_Files_ChatId ON Files(chatId)',
        'CREATE INDEX IF NOT EXISTS IX_Sessions_UserId ON Sessions(userId)',
        'CREATE INDEX IF NOT EXISTS IX_Sessions_Token ON Sessions(token)',
        'CREATE INDEX IF NOT EXISTS IX_Sessions_ExpiresAt ON Sessions(expiresAt)',
        'CREATE INDEX IF NOT EXISTS IX_AuditLogs_UserId ON AuditLogs(userId)',
        'CREATE INDEX IF NOT EXISTS IX_AuditLogs_CreatedAt ON AuditLogs(createdAt DESC)',
        'CREATE INDEX IF NOT EXISTS IX_DatabaseConnections_UserId ON DatabaseConnections(userId)',
        'CREATE INDEX IF NOT EXISTS IX_DatabaseConnections_Type ON DatabaseConnections(type)',
        'CREATE INDEX IF NOT EXISTS IX_DatabaseConnections_Status ON DatabaseConnections(status)',
        'CREATE INDEX IF NOT EXISTS IX_Feedback_UserId ON Feedback(userId)',
        'CREATE INDEX IF NOT EXISTS IX_Feedback_Category ON Feedback(category)',
        'CREATE INDEX IF NOT EXISTS IX_Feedback_Status ON Feedback(status)',
        'CREATE INDEX IF NOT EXISTS IX_Feedback_Priority ON Feedback(priority)',
        'CREATE INDEX IF NOT EXISTS IX_Feedback_CreatedAt ON Feedback(createdAt DESC)',
        'CREATE INDEX IF NOT EXISTS IX_WorkspaceUsers_WorkspaceId ON WorkspaceUsers(workspaceId)',
        'CREATE INDEX IF NOT EXISTS IX_WorkspaceUsers_UserId ON WorkspaceUsers(userId)',
        'CREATE INDEX IF NOT EXISTS IX_WorkspaceUsers_AccessLevel ON WorkspaceUsers(accessLevel)',
        'CREATE INDEX IF NOT EXISTS IX_Users_Role ON Users(role)'
      ];

      for (const indexQuery of indexes) {
        try {
          await this.pool.request().query(indexQuery.replace('IF NOT EXISTS', ''));
        } catch (error) {
          // Index might already exist, continue
          logger.debug('Index creation skipped:', error);
        }
      }

      logger.info('✅ Database schema initialized');
    } catch (error) {
      logger.error('❌ Failed to initialize database schema:', error);
      throw error;
    }
  }
}