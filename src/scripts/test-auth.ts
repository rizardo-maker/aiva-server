import dotenv from 'dotenv';
import path from 'path';
import { DatabaseManager } from '../config/database';
import bcrypt from 'bcryptjs';
import * as sql from 'mssql';

// Load environment variables from the correct path
const envPath = path.resolve(__dirname, '../../../.env');
console.log('Loading .env file from:', envPath);
dotenv.config({ path: envPath });

async function testAuthentication() {
  try {
    console.log('Testing database authentication...');
    
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
    
    // Test user credentials
    const email = 'test@example.com';
    const password = 'password123';
    
    console.log(`\nTesting login for user: ${email}`);
    
    // Get user from database
    const result = await pool.request()
      .input('email', sql.NVarChar, email)
      .query('SELECT * FROM Users WHERE email = @email');
    
    if (result.recordset.length === 0) {
      console.log('❌ User not found in database');
      return;
    }
    
    const user = result.recordset[0];
    console.log('✅ User found in database');
    console.log(`User ID: ${user.id}`);
    console.log(`Name: ${user.firstName} ${user.lastName}`);
    console.log(`Role: ${user.role}`);
    
    // Check password
    if (!user.password) {
      console.log('❌ No password hash found for user');
      return;
    }
    
    const isValidPassword = await bcrypt.compare(password, user.password);
    
    if (isValidPassword) {
      console.log('✅ Password verification successful');
      console.log('\n🎉 Authentication test passed!');
    } else {
      console.log('❌ Password verification failed');
    }
    
  } catch (error) {
    console.error('❌ Authentication test failed:', error);
    process.exit(1);
  }
}

// Run the test
testAuthentication();