import dotenv from 'dotenv';
import path from 'path';
import { DatabaseManager } from '../config/database';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import sql from 'mssql';

// Load environment variables from the correct path
const envPath = path.resolve(__dirname, '../../../.env');
console.log('Loading .env file from:', envPath);
dotenv.config({ path: envPath });

async function initializeDatabase() {
  try {
    console.log('Initializing database...');
    
    // Check if environment variables are loaded
    console.log('SQL_SERVER:', process.env.SQL_SERVER);
    console.log('SQL_DATABASE:', process.env.SQL_DATABASE);
    console.log('SQL_USERNAME:', process.env.SQL_USERNAME);
    console.log('SQL_PASSWORD:', process.env.SQL_PASSWORD ? '****' : 'NOT SET');
    
    // Get database manager instance
    const dbManager = DatabaseManager.getInstance();
    
    // Connect to database
    const pool = await dbManager.getPool();
    console.log('✅ Database connected successfully');
    
    // Create test users if they don't exist
    const testUsers = [
      {
        email: 'test@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
        role: 'user'
      },
      {
        email: 'admin@example.com',
        password: 'admin123',
        firstName: 'Admin',
        lastName: 'User',
        role: 'admin'
      }
    ];
    
    for (const userData of testUsers) {
      // Check if user already exists
      const existingUser = await pool.request()
        .input('email', sql.NVarChar, userData.email)
        .query('SELECT * FROM Users WHERE email = @email');
      
      if (existingUser.recordset.length === 0) {
        // Create new user
        const hashedPassword = await bcrypt.hash(userData.password, 12);
        const userId = uuidv4();
        
        await pool.request()
          .input('id', sql.NVarChar, userId)
          .input('firstName', sql.NVarChar, userData.firstName)
          .input('lastName', sql.NVarChar, userData.lastName)
          .input('email', sql.NVarChar, userData.email)
          .input('password', sql.NVarChar, hashedPassword)
          .input('provider', sql.NVarChar, 'local')
          .input('role', sql.NVarChar, userData.role)
          .query(`
            INSERT INTO Users (id, firstName, lastName, email, password, provider, role)
            VALUES (@id, @firstName, @lastName, @email, @password, @provider, @role)
          `);
        
        console.log(`✅ Created ${userData.role} user: ${userData.email}`);
      } else {
        console.log(`ℹ️  ${userData.role} user already exists: ${userData.email}`);
      }
    }
    
    // List all users
    console.log('\n📋 All users in database:');
    const allUsers = await pool.request().query('SELECT id, firstName, lastName, email, provider, role, createdAt FROM Users');
    console.table(allUsers.recordset);
    
    console.log('\n✅ Database initialization completed successfully');
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  }
}

// Run the initialization
initializeDatabase();