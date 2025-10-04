import dotenv from 'dotenv';
import path from 'path';
import { DatabaseManager } from '../config/database';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import sql from 'mssql';

// Load environment variables from the server directory
const envPath = path.resolve(__dirname, '../../.env');
console.log('Loading .env file from:', envPath);
dotenv.config({ path: envPath });

// Predefined users to create
const PREDEFINED_USERS = [
  {
    firstName: 'Sudhen',
    lastName: 'Reddy',
    email: 'sudhenreddym@gmail.com',
    password: 'TempPassword123!',
    role: 'user'
  },
  {
    firstName: 'AIVA',
    lastName: 'User',
    email: 'aiva50543@gmail.com',
    password: 'TempPassword123!',
    role: 'user'
  },
  {
    firstName: 'Samuel',
    lastName: 'George',
    email: 'samuelgeorge0802@gmail.com',
    password: 'TempPassword123!',
    role: 'user'
  },
  {
    firstName: 'Jacinth',
    lastName: 'Gilbert',
    email: 'jacinthgilbert2006@gmail.com',
    password: 'TempPassword123!',
    role: 'user'
  }
];

async function createPredefinedUsers() {
  try {
    console.log('🚀 Creating predefined users for AIVA system...');
    
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
    
    const results: Array<{
      email: string;
      status: 'created' | 'exists' | 'failed';
      id?: string;
      error?: string;
    }> = [];
    
    for (const userData of PREDEFINED_USERS) {
      try {
        // Check if user already exists
        const existingUser = await pool.request()
          .input('email', sql.NVarChar, userData.email.toLowerCase())
          .query('SELECT id, email FROM Users WHERE email = @email');
        
        if (existingUser.recordset.length > 0) {
          console.log(`ℹ️  User already exists: ${userData.email}`);
          results.push({ email: userData.email, status: 'exists', id: existingUser.recordset[0].id });
          continue;
        }
        
        // Create new user
        const hashedPassword = await bcrypt.hash(userData.password, 12);
        const userId = uuidv4();
        
        await pool.request()
          .input('id', sql.NVarChar, userId)
          .input('firstName', sql.NVarChar, userData.firstName)
          .input('lastName', sql.NVarChar, userData.lastName)
          .input('email', sql.NVarChar, userData.email.toLowerCase())
          .input('password', sql.NVarChar, hashedPassword)
          .input('provider', sql.NVarChar, 'local')
          .input('role', sql.NVarChar, userData.role)
          .input('createdAt', sql.DateTime2, new Date())
          .input('updatedAt', sql.DateTime2, new Date())
          .query(`
            INSERT INTO Users (id, firstName, lastName, email, password, provider, role, createdAt, updatedAt)
            VALUES (@id, @firstName, @lastName, @email, @password, @provider, @role, @createdAt, @updatedAt)
          `);
        
        console.log(`✅ Created user: ${userData.email} (ID: ${userId})`);
        results.push({ email: userData.email, status: 'created', id: userId });
        
      } catch (error) {
        console.error(`❌ Failed to create user ${userData.email}:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({ email: userData.email, status: 'failed', error: errorMessage });
      }
    }
    
    // Summary
    console.log('\n📊 Summary:');
    console.log('='.repeat(60));
    
    const created = results.filter(r => r.status === 'created');
    const existing = results.filter(r => r.status === 'exists');
    const failed = results.filter(r => r.status === 'failed');
    
    console.log(`✅ Created: ${created.length} users`);
    console.log(`ℹ️  Already existed: ${existing.length} users`);
    console.log(`❌ Failed: ${failed.length} users`);
    
    if (created.length > 0) {
      console.log('\n🎉 Successfully created users:');
      created.forEach(result => {
        console.log(`   • ${result.email} (ID: ${result.id})`);
      });
    }
    
    if (existing.length > 0) {
      console.log('\n📋 Users that already existed:');
      existing.forEach(result => {
        console.log(`   • ${result.email} (ID: ${result.id})`);
      });
    }
    
    if (failed.length > 0) {
      console.log('\n❌ Failed to create users:');
      failed.forEach(result => {
        console.log(`   • ${result.email}: ${result.error}`);
      });
    }
    
    // List all users to verify
    console.log('\n📋 All users in database:');
    const allUsers = await pool.request().query(`
      SELECT id, firstName, lastName, email, provider, role, createdAt 
      FROM Users 
      ORDER BY createdAt DESC
    `);
    console.table(allUsers.recordset);
    
    console.log('\n✨ User creation process completed!');
    console.log('\n📝 Next steps:');
    console.log('1. Users can now log in with their email and password: TempPassword123!');
    console.log('2. Use the admin interface to assign users to workspaces');
    console.log('3. Users should change their passwords on first login');
    console.log('4. Test the workspace assignment functionality');
    
  } catch (error) {
    console.error('💥 User creation failed:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  createPredefinedUsers()
    .then(() => {
      console.log('\n🎯 Script execution completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Script execution failed:', error);
      process.exit(1);
    });
}

export { createPredefinedUsers, PREDEFINED_USERS };
