import { DatabaseManager } from '../config/database';
import * as bcrypt from 'bcryptjs';
import * as sql from 'mssql';

async function testLogin() {
  try {
    console.log('Testing login functionality...');
    
    // Get database manager instance
    const dbManager = DatabaseManager.getInstance();
    
    // Connect to database
    const pool = await dbManager.getPool();
    console.log('✅ Database connected successfully');
    
    // Test user credentials (these should match what you're trying to log in with)
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
    console.log(`Provider: ${user.provider}`);
    
    // Check if this is a local user
    if (user.provider !== 'local') {
      console.log(`❌ This user uses ${user.provider} login, not local email/password`);
      return;
    }
    
    // Check password
    if (!user.password) {
      console.log('❌ No password hash found for user');
      return;
    }
    
    console.log('Password hash:', user.password);
    
    const isValidPassword = await bcrypt.compare(password, user.password);
    
    if (isValidPassword) {
      console.log('✅ Password verification successful');
      console.log('\n🎉 Login test passed!');
    } else {
      console.log('❌ Password verification failed');
      console.log('This could be due to:');
      console.log('1. Incorrect password');
      console.log('2. Password not properly hashed when user was created');
      console.log('3. Database connection issues');
    }
    
  } catch (error) {
    console.error('❌ Login test failed:', error);
    process.exit(1);
  }
}

// Run the test
testLogin();