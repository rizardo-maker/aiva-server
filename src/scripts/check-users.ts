import { DatabaseManager } from '../config/database';
import sql from 'mssql';

async function checkUsers() {
  try {
    console.log('Checking users in database...');
    
    // Get database manager instance
    const dbManager = DatabaseManager.getInstance();
    
    // Connect to database
    const pool = await dbManager.getPool();
    console.log('✅ Database connected successfully');
    
    // List all users
    console.log('\n📋 All users in database:');
    const allUsers = await pool.request().query('SELECT id, firstName, lastName, email, provider, role, createdAt FROM Users');
    console.table(allUsers.recordset);
    
    console.log('\n✅ User check completed successfully');
    
  } catch (error) {
    console.error('❌ User check failed:', error);
    process.exit(1);
  }
}

// Run the script
checkUsers();