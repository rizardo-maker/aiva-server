import express from 'express';
import { ConfidentialClientApplication } from '@azure/msal-node';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import Joi from 'joi';
import { logger } from '../utils/logger';
import { DatabaseManager } from '../config/database';
import * as sql from 'mssql';
import { v4 as uuidv4 } from 'uuid';
import { authenticateToken } from '../middleware/auth';

// Microsoft Graph API response type
type MicrosoftGraphUser = {
  id: string;
  mail: string | null;
  userPrincipalName: string;
  displayName: string;
  givenName?: string;
  surname?: string;
};

const router = express.Router();
const dbManager = DatabaseManager.getInstance();

// Database helper functions
async function createUser(userData: any) {
  try {
    const pool = await dbManager.getPool();
    const result = await pool.request()
      .input('id', sql.NVarChar, userData.id)
      .input('firstName', sql.NVarChar, userData.firstName)
      .input('lastName', sql.NVarChar, userData.lastName)
      .input('email', sql.NVarChar, userData.email)
      .input('password', sql.NVarChar, userData.password || null)
      .input('provider', sql.NVarChar, userData.provider)
      .input('providerId', sql.NVarChar, userData.providerId || null)
      .input('role', sql.NVarChar, userData.role || 'user')
      .input('preferences', sql.NVarChar, userData.preferences ? JSON.stringify(userData.preferences) : null)
      .query(`
        INSERT INTO Users (id, firstName, lastName, email, password, provider, providerId, role, preferences)
        OUTPUT INSERTED.*
        VALUES (@id, @firstName, @lastName, @email, @password, @provider, @providerId, @role, @preferences)
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

async function getUserById(userId: string) {
  try {
    const pool = await dbManager.getPool();
    const result = await pool.request()
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

async function getUserByEmail(email: string) {
  try {
    const pool = await dbManager.getPool();
    const result = await pool.request()
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

async function updateUserLastLogin(userId: string) {
  try {
    const pool = await dbManager.getPool();
    await pool.request()
      .input('id', sql.NVarChar, userId)
      .input('lastLoginAt', sql.DateTime2, new Date())
      .query('UPDATE Users SET lastLoginAt = @lastLoginAt, updatedAt = GETUTCDATE() WHERE id = @id');
    
    logger.info(`Updated last login for user: ${userId}`);
  } catch (error) {
    logger.error('Error updating user last login:', error);
    throw error;
  }
}

// MSAL configuration
let cca: ConfidentialClientApplication | null = null;

// Define msalConfig at the module level
const msalConfig = {
  auth: {
    clientId: process.env.AZURE_CLIENT_ID || '',
    clientSecret: process.env.AZURE_CLIENT_SECRET || '',
    authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID || ''}`
  }
};

// Initialize Microsoft Authentication
console.log('🔍 AUTH ROUTE: Starting Microsoft Authentication initialization...');
console.log('AZURE_CLIENT_ID:', process.env.AZURE_CLIENT_ID ? 'SET' : 'MISSING');
console.log('AZURE_CLIENT_SECRET:', process.env.AZURE_CLIENT_SECRET ? (process.env.AZURE_CLIENT_SECRET.includes('PLACEHOLDER') ? 'PLACEHOLDER' : 'SET') : 'MISSING');
console.log('AZURE_TENANT_ID:', process.env.AZURE_TENANT_ID ? 'SET' : 'MISSING');
console.log('MOCK_AZURE_AUTH:', process.env.MOCK_AZURE_AUTH || 'false');

try {
  // Check if we should use mock authentication
  if (process.env.MOCK_AZURE_AUTH === 'true' || process.env.NODE_ENV === 'development') {
    console.log('🔧 Using mock Azure authentication for development');
    logger.info('🔧 Using mock Azure authentication for development');
  } else if (process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET && process.env.AZURE_TENANT_ID && !process.env.AZURE_CLIENT_SECRET.includes('PLACEHOLDER')) {
    console.log('🔧 Creating ConfidentialClientApplication...');
    cca = new ConfidentialClientApplication(msalConfig);
    console.log('✅ Microsoft Authentication initialized successfully');
    logger.info('✅ Microsoft Authentication initialized successfully');
  } else {
    console.log('⚠️ Microsoft Authentication not initialized. Missing or invalid environment variables.');
    logger.warn('⚠️ Microsoft Authentication not initialized. Missing or invalid environment variables.');
  }
} catch (error) {
  console.error('❌ Failed to initialize Microsoft Authentication:', error);
  logger.error('❌ Failed to initialize Microsoft Authentication:', error);
}

// Validation schemas
const registerSchema = Joi.object({
  firstName: Joi.string().required().min(2).max(50),
  lastName: Joi.string().required().min(2).max(50),
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required()
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

// Helper function to generate JWT token
function generateToken(userId: string, email: string, role: string = 'user') {
  return jwt.sign(
    { userId, email, role },
    process.env.JWT_SECRET as string,
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' } as jwt.SignOptions
  );
}

// Initialize admin user if not exists
async function initializeAdminUser() {
  try {
    const adminEmail = 'sudhenreddym@gmail.com';
    const existingAdmin = await getUserByEmail(adminEmail);
    
    if (!existingAdmin) {
      logger.info('Creating default admin user...');
      const hashedPassword = await bcrypt.hash('admin123', 12); // Default password
      
      const adminUser = {
        id: uuidv4(),
        firstName: 'Sudhen',
        lastName: 'Reddy',
        email: adminEmail,
        password: hashedPassword,
        provider: 'local',
        role: 'admin'
      };
      
      await createUser(adminUser);
      logger.info('✅ Default admin user created successfully');
    } else if (existingAdmin.role !== 'admin') {
      // Update existing user to admin role
      const pool = await dbManager.getPool();
      await pool.request()
        .input('email', sql.NVarChar, adminEmail)
        .input('role', sql.NVarChar, 'admin')
        .query('UPDATE Users SET role = @role WHERE email = @email');
      logger.info('✅ Updated existing user to admin role');
    }
  } catch (error) {
    logger.error('❌ Failed to initialize admin user:', error);
  }
}

// Initialize admin user on startup
initializeAdminUser();

// Register endpoint
router.post('/register', async (req, res) => {
  try {
    const { error, value } = registerSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details[0].message
      });
    }

    const { firstName, lastName, email, password } = value;

    // Check if user already exists
    const existingUser = await getUserByEmail(email);
    if (existingUser) {
      return res.status(409).json({
        error: 'User already exists',
        message: 'An account with this email already exists'
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user
    const userData = {
      id: uuidv4(),
      firstName,
      lastName,
      email,
      password: hashedPassword,
      provider: 'local',
      role: 'user'
    };

    const user = await createUser(userData);

    // Generate token
    const token = generateToken(user.id, user.email, user.role || 'user');

    // Remove password from response
    const { password: _, ...userResponse } = user;

    res.status(201).json({
      message: 'User registered successfully',
      user: userResponse,
      token
    });

    logger.info(`User registered: ${email}`);
  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to register user'
    });
  }
});

// Login endpoint
router.post('/login', async (req, res) => {
  try {
    logger.info(`🔐 Login attempt from IP: ${req.ip}, User-Agent: ${req.get('User-Agent')?.substring(0, 50)}`);
    logger.info(`📧 Login request body: ${JSON.stringify(req.body, null, 2)}`);
    
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      logger.warn('Login validation failed:', error.details[0].message);
      return res.status(400).json({
        error: 'Validation error',
        details: error.details[0].message
      });
    }

    const { email, password } = value;

    // Get user
    const user = await getUserByEmail(email);
    
    if (!user) {
      logger.info(`Login failed: User not found for email ${email}`);
      return res.status(401).json({
        error: 'Authentication failed',
        message: 'Invalid email or password'
      });
    }
    
    // If no password hash, this might be a Microsoft OAuth user
    if (!user.password) {
      logger.info(`Login failed: User ${email} has no password (likely OAuth user)`);
      return res.status(401).json({
        error: 'Authentication failed',
        message: 'This account uses Microsoft login. Please sign in with Microsoft.'
      });
    }

    // Check password
    logger.debug(`Verifying password for user ${email}`);
    const isValidPassword = await bcrypt.compare(password, user.password);
    
    if (!isValidPassword) {
      logger.info(`Login failed: Invalid password for user ${email}`);
      return res.status(401).json({
        error: 'Authentication failed',
        message: 'Invalid email or password'
      });
    }

    // Update last login time
    await updateUserLastLogin(user.id);

    // Generate token
    const token = generateToken(user.id, user.email, user.role || 'user');

    // Remove password from response
    const { password: _, ...userResponse } = user;

    res.json({
      message: 'Login successful',
      user: userResponse,
      token
    });

    logger.info(`User logged in successfully: ${email}`);
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to login'
    });
  }
});

// Microsoft OAuth callback (GET - for mobile app redirect)
router.get('/microsoft/callback', async (req, res) => {
  try {
    const { code, error, error_description } = req.query;

    if (error) {
      logger.error('Microsoft OAuth error:', error, error_description);
      return res.status(400).json({
        error: 'Microsoft authentication failed',
        message: error_description || error
      });
    }

    if (!code) {
      return res.status(400).json({
        error: 'Authorization code not found',
        message: 'Microsoft authentication did not provide an authorization code'
      });
    }

    // For development: Use mock Microsoft authentication
    const isDevelopment = process.env.NODE_ENV === 'development' || 
                         process.env.MOCK_AZURE_AUTH === 'true' || 
                         !cca || 
                         process.env.AZURE_CLIENT_SECRET?.includes('PLACEHOLDER');
    
    if (isDevelopment) {
      logger.info('🔧 Using mock Microsoft authentication for development');
      
      try {
        // Mock user data for development
        const mockUserInfo = {
          id: 'mock-user-id-' + Date.now(),
          displayName: 'Aiva App',
          mail: 'developer@aiva.com',
          userPrincipalName: 'developer@aiva.com'
        };
        
        const email = mockUserInfo.mail;
        const name = mockUserInfo.displayName;

        // Try to check if user exists, but handle database errors gracefully
        let dbUser;
        try {
          dbUser = await getUserByEmail(email);
        } catch (dbError) {
          logger.warn('Database error, using mock user data:', dbError);
          dbUser = null;
        }
        
        if (!dbUser) {
          const [firstName, ...lastNameParts] = name.split(' ');
          const lastName = lastNameParts.join(' ');

          const userData = {
            id: uuidv4(),
            firstName: firstName || 'Test',
            lastName: lastName || 'User',
            email,
            provider: 'microsoft',
            providerId: mockUserInfo.id,
            role: 'user'
          };

          try {
            dbUser = await createUser(userData);
            logger.info(`Mock Microsoft user created: ${email}`);
          } catch (dbError) {
            logger.warn('Database error creating user, using mock data:', dbError);
            // Use mock user data if database fails
            dbUser = {
              id: userData.id,
              firstName: userData.firstName,
              lastName: userData.lastName,
              email: userData.email,
              provider: userData.provider,
              role: userData.role
            };
          }
        } else {
          try {
            await updateUserLastLogin(dbUser.id);
            logger.info(`Mock Microsoft user logged in: ${email}`);
          } catch (dbError) {
            logger.warn('Database error updating login time:', dbError);
            // Continue anyway
          }
        }

        // Generate JWT token
        const token = generateToken(dbUser.id, dbUser.email, dbUser.role || 'user');

        return res.json({
          message: 'Microsoft login successful (development mode)',
          user: {
            id: dbUser.id,
            firstName: dbUser.firstName,
            lastName: dbUser.lastName,
            email: dbUser.email,
            provider: dbUser.provider || 'microsoft',
            role: dbUser.role || 'user'
          },
          token
        });
      } catch (error) {
        logger.error('Mock authentication error:', error);
        return res.status(500).json({
          error: 'Mock authentication failed',
          message: 'Development authentication error'
        });
      }
    }

    // Initialize MSAL client if not already done
    if (!cca) {
      logger.info('Initializing Microsoft Authentication...');
      
      if (!process.env.AZURE_CLIENT_ID || !process.env.AZURE_CLIENT_SECRET || !process.env.AZURE_TENANT_ID) {
        logger.error('Microsoft Authentication environment variables missing');
        return res.status(500).json({
          error: 'Microsoft authentication not configured',
          message: 'Server configuration error - missing environment variables'
        });
      }

      try {
        cca = new ConfidentialClientApplication(msalConfig);
        logger.info('✅ Microsoft Authentication initialized');
      } catch (initError) {
        logger.error('Failed to initialize Microsoft Authentication:', initError);
        return res.status(500).json({
          error: 'Microsoft authentication initialization failed',
          message: initError instanceof Error ? initError.message : 'Unknown error'
        });
      }
    }

    // Exchange authorization code for tokens
    const clientCredentialRequest = {
      scopes: ['https://graph.microsoft.com/.default'],
      code: code as string,
      redirectUri: process.env.MICROSOFT_REDIRECT_URI || 'aivamobile://auth/microsoft/callback',
    };

    const response = await cca.acquireTokenByCode(clientCredentialRequest);
    
    if (!response) {
      throw new Error('Failed to acquire token from Microsoft');
    }

    // Get user info from Microsoft Graph
    const accessToken = response.accessToken;
    const userInfoResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!userInfoResponse.ok) {
      throw new Error('Failed to get user info from Microsoft Graph');
    }

    const userInfo = await userInfoResponse.json() as MicrosoftGraphUser;
    const email = userInfo.mail || userInfo.userPrincipalName;
    const name = userInfo.displayName || email.split('@')[0];

    if (!email) {
      return res.status(400).json({
        error: 'Email not found in Microsoft account'
      });
    }

    // Check if user exists, create if not
    let dbUser = await getUserByEmail(email);
    
    if (!dbUser) {
      // Create new user from Microsoft account
      const [firstName, ...lastNameParts] = (name || email.split('@')[0] || 'Microsoft User').split(' ');
      const lastName = lastNameParts.join(' ');

      const userData = {
        id: uuidv4(),
        firstName: firstName || 'Microsoft',
        lastName: lastName || 'User',
        email,
        provider: 'microsoft',
        providerId: userInfo.id,
        role: 'user'
      };

      dbUser = await createUser(userData);
      logger.info(`New Microsoft user created: ${email}`);
    } else {
      // Update existing user's last login
      await updateUserLastLogin(dbUser.id);
      logger.info(`Existing Microsoft user logged in: ${email}`);
    }

    // Generate JWT token
    const token = generateToken(dbUser.id, dbUser.email, dbUser.role || 'user');

    res.json({
      message: 'Microsoft login successful',
      user: {
        id: dbUser.id,
        firstName: dbUser.firstName,
        lastName: dbUser.lastName,
        email: dbUser.email,
        provider: dbUser.provider,
        role: dbUser.role
      },
      token
    });

    logger.info(`Microsoft OAuth login successful: ${email}`);
  } catch (error) {
    logger.error('Microsoft OAuth GET callback error:', error);
    
    let errorMessage = 'Microsoft authentication failed';
    if (error instanceof Error) {
      if (error.message.includes('AADSTS')) {
        errorMessage = 'Microsoft authentication error. Please check your credentials.';
      } else if (error.message.includes('redirect_uri')) {
        errorMessage = 'Redirect URI mismatch. Please check your app configuration.';
      } else if (error.message.includes('invalid_client')) {
        errorMessage = 'Invalid client configuration. Please check your app registration.';
      }
    }
    
    res.status(500).json({
      error: errorMessage,
      message: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

// Microsoft OAuth callback (POST - for web app)
router.post('/microsoft/callback', async (req, res) => {
  try {
    const { user, email, name, tenantId, provider, code, clientId } = req.body;

    if (!email) {
      return res.status(400).json({
        error: 'Email not found in Microsoft account'
      });
    }

    // Check if user exists, create if not
    let dbUser = await getUserByEmail(email);
    
    if (!dbUser) {
      // Create new user from Microsoft account
      const [firstName, ...lastNameParts] = (name || email.split('@')[0] || 'Microsoft User').split(' ');
      const lastName = lastNameParts.join(' ');

      const userData = {
        id: uuidv4(),
        firstName: firstName || 'Microsoft',
        lastName: lastName || 'User',
        email,
        provider: 'microsoft',
        providerId: user?.id || email,
        tenantId: tenantId || process.env.AZURE_TENANT_ID,
        role: 'user', // Default role
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      dbUser = await createUser(userData);
      logger.info(`New Microsoft user created: ${email}`);
    } else {
      // Update existing user's last login
      await updateUserLastLogin(dbUser.id);
      logger.info(`Existing Microsoft user logged in: ${email}`);
    }

    // Generate JWT token
    const token = generateToken(dbUser.id, dbUser.email, dbUser.role || 'user');

    res.json({
      message: 'Microsoft login successful',
      user: {
        id: dbUser.id,
        firstName: dbUser.firstName,
        lastName: dbUser.lastName,
        email: dbUser.email,
        provider: dbUser.provider,
        role: dbUser.role,
        tenantId: dbUser.tenantId
      },
      token
    });

    logger.info(`Microsoft OAuth login successful: ${email}`);
  } catch (error) {
    logger.error('Microsoft OAuth error:', error);
    
    // Provide more specific error messages
    let errorMessage = 'Microsoft authentication failed';
    if (error instanceof Error) {
      if (error.message.includes('AADSTS')) {
        errorMessage = 'Microsoft authentication error. Please check your credentials.';
      } else if (error.message.includes('redirect_uri')) {
        errorMessage = 'Redirect URI mismatch. Please check your app configuration.';
      } else if (error.message.includes('invalid_client')) {
        errorMessage = 'Invalid client configuration. Please check your app registration.';
      }
    }
    
    res.status(500).json({
      error: errorMessage,
      message: 'Please try again or contact support if the issue persists'
    });
  }
});

// Google OAuth callback (placeholder - requires Google OAuth setup)
router.post('/google/callback', async (req, res) => {
  try {
    // This would require Google OAuth library setup
    // For now, return a placeholder response
    res.status(501).json({
      error: 'Google OAuth not implemented yet',
      message: 'Please use Microsoft login or email/password'
    });
  } catch (error) {
    logger.error('Google OAuth error:', error);
    res.status(500).json({
      error: 'Google authentication failed'
    });
  }
});

// Yahoo OAuth callback (placeholder)
router.post('/yahoo/callback', async (req, res) => {
  try {
    res.status(501).json({
      error: 'Yahoo OAuth not implemented yet',
      message: 'Please use Microsoft login or email/password'
    });
  } catch (error) {
    logger.error('Yahoo OAuth error:', error);
    res.status(500).json({
      error: 'Yahoo authentication failed'
    });
  }
});

// Verify token endpoint
router.get('/verify', authenticateToken, async (req, res) => {
  try {
    const user = await getUserById(req.user.userId);
    
    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    const { password: _, ...userResponse } = user;

    res.json({
      message: 'Token valid',
      user: userResponse
    });
  } catch (error) {
    logger.error('Token verification error:', error);
    res.status(500).json({
      error: 'Token verification failed'
    });
  }
});

// Auth status endpoint
router.get('/status', (req, res) => {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const hasMsalConfig = !!(process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET && process.env.AZURE_TENANT_ID);
  
  res.json({
    status: 'ok',
    message: 'Authentication service is running',
    microsoftAuth: !!cca || (isDevelopment && hasMsalConfig),
    developmentMode: isDevelopment,
    services: {
      sql: process.env.MOCK_SQL !== 'true' ? 'REAL' : 'MOCK',
      openai: process.env.MOCK_OPENAI !== 'true' ? 'REAL' : 'MOCK',
    },
    environment: {
      AZURE_CLIENT_ID: process.env.AZURE_CLIENT_ID ? 'SET' : 'MISSING',
      AZURE_CLIENT_SECRET: process.env.AZURE_CLIENT_SECRET ? 'SET' : 'MISSING',
      AZURE_TENANT_ID: process.env.AZURE_TENANT_ID ? 'SET' : 'MISSING',
      AZURE_OPENAI_ENDPOINT: process.env.AZURE_OPENAI_ENDPOINT ? 'SET' : 'MISSING',
      AZURE_OPENAI_API_KEY: process.env.AZURE_OPENAI_API_KEY ? 'SET' : 'MISSING',
      SQL_SERVER: process.env.SQL_SERVER ? 'SET' : 'MISSING'
    },
    timestamp: new Date().toISOString()
  });
});

// Logout endpoint
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    // Update user's last logout time in database
    const userId = req.user.userId;
    
    const pool = await dbManager.getPool();
    await pool.request()
      .input('id', sql.NVarChar, userId)
      .input('lastLogoutAt', sql.DateTime2, new Date())
      .query('UPDATE Users SET lastLogoutAt = @lastLogoutAt, updatedAt = GETUTCDATE() WHERE id = @id');
    
    logger.info(`User logged out: ${userId}`);
    
    res.json({
      message: 'Logout successful'
    });
  } catch (error) {
    logger.error('Logout error:', error);
    // Even if database update fails, still return success for logout
    res.json({
      message: 'Logout successful'
    });
  }
});

export { router as authRoutes };