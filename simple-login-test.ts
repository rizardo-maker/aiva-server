import express from 'express';
import dotenv from 'dotenv';
import { logger } from './src/utils/logger';
import { DatabaseManager } from './src/config/database';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import * as sql from 'mssql';

// Load environment variables
dotenv.config();

const app = express();
app.use(express.json());

// Simple login endpoint for testing
app.post('/test-login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password are required'
      });
    }
    
    console.log(`Testing login for: ${email}`);
    
    // Get database connection
    const dbManager = DatabaseManager.getInstance();
    const pool = await dbManager.getPool();
    
    // Get user
    const result = await pool.request()
      .input('email', sql.NVarChar, email)
      .query('SELECT * FROM Users WHERE email = @email');
    
    if (result.recordset.length === 0) {
      console.log(`User not found for email ${email}`);
      return res.status(401).json({
        error: 'Authentication failed',
        message: 'Invalid email or password'
      });
    }
    
    const user = result.recordset[0];
    console.log(`User found: ${user.firstName} ${user.lastName}`);
    console.log(`Provider: ${user.provider}`);
    console.log(`Has password: ${!!user.password}`);
    
    // If no password hash, this might be a Microsoft OAuth user
    if (!user.password) {
      console.log(`User ${email} has no password (likely OAuth user)`);
      return res.status(401).json({
        error: 'Authentication failed',
        message: 'This account uses Microsoft login. Please sign in with Microsoft.'
      });
    }
    
    console.log(`Stored password hash: ${user.password}`);
    
    // Check password
    console.log(`Verifying password for user ${email}...`);
    const isValidPassword = await bcrypt.compare(password, user.password);
    
    if (!isValidPassword) {
      console.log(`Invalid password for user ${email}`);
      return res.status(401).json({
        error: 'Authentication failed',
        message: 'Invalid email or password'
      });
    }
    
    console.log('Password verification successful!');
    
    // Generate token
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role || 'user' },
      process.env.JWT_SECRET as string,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' } as jwt.SignOptions
    );
    
    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        provider: user.provider,
        role: user.role
      },
      token
    });
    
    console.log(`User logged in successfully: ${email}`);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to login'
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, async () => {
  logger.info(`🚀 Simple login test server running on port ${PORT}`);
  
  // Test database connection
  try {
    const dbManager = DatabaseManager.getInstance();
    const pool = await dbManager.getPool();
    logger.info('✅ Database connected successfully');
    
    // List a few users
    const result = await pool.request().query('SELECT TOP 5 id, firstName, lastName, email, provider, role FROM Users');
    console.log('Sample users:');
    result.recordset.forEach((user: any) => {
      console.log(`- ${user.email} (${user.firstName} ${user.lastName}) - ${user.provider}`);
    });
  } catch (error) {
    logger.error('❌ Database connection failed:', error);
  }
});