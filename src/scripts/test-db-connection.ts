import { DatabaseManager } from '../config/database';
import { logger } from '../utils/logger';

async function testDatabaseConnection() {
  try {
    console.log('Testing database connection...');
    
    // Get database manager instance
    const dbManager = DatabaseManager.getInstance();
    
    // Connect to database
    const pool = await dbManager.getPool();
    console.log('✅ Database connected successfully');
    
    // Test a simple query
    const result = await pool.request().query('SELECT 1 as test');
    console.log('✅ Simple query executed successfully:', result.recordset);
    
    // List all users
    console.log('\n📋 All users in database:');
    const allUsers = await pool.request().query('SELECT id, firstName, lastName, email, provider, role, createdAt FROM Users');
    console.table(allUsers.recordset);
    
  } catch (error) {
    console.error('❌ Database connection test failed:', error);
    process.exit(1);
  }
}

// Run the test
testDatabaseConnection();