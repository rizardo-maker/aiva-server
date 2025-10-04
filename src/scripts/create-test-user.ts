import { DatabaseManager } from '../config/database';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import sql from 'mssql';

async function createTestUser() {
  try {
    console.log('Creating test user...');
    
    // Get database manager instance
    const dbManager = DatabaseManager.getInstance();
    
    // Connect to database
    const pool = await dbManager.getPool();
    console.log('✅ Database connected successfully');
    
    // Test user data
    const testUser = {
      email: 'test@example.com',
      password: 'password123',
      firstName: 'Test',
      lastName: 'User',
      role: 'user'
    };
    
    // Check if user already exists
    const existingUser = await pool.request()
      .input('email', sql.NVarChar, testUser.email)
      .query('SELECT * FROM Users WHERE email = @email');
    
    if (existingUser.recordset.length > 0) {
      console.log(`ℹ️  User already exists: ${testUser.email}`);
      console.log('User details:', existingUser.recordset[0]);
    } else {
      // Create new user
      const hashedPassword = await bcrypt.hash(testUser.password, 12);
      const userId = uuidv4();
      
      await pool.request()
        .input('id', sql.NVarChar, userId)
        .input('firstName', sql.NVarChar, testUser.firstName)
        .input('lastName', sql.NVarChar, testUser.lastName)
        .input('email', sql.NVarChar, testUser.email)
        .input('password', sql.NVarChar, hashedPassword)
        .input('provider', sql.NVarChar, 'local')
        .input('role', sql.NVarChar, testUser.role)
        .query(`
          INSERT INTO Users (id, firstName, lastName, email, password, provider, role)
          VALUES (@id, @firstName, @lastName, @email, @password, @provider, @role)
        `);
      
      console.log(`✅ Created user: ${testUser.email}`);
    }
    
    // Also create an admin user
    const adminUser = {
      email: 'admin@example.com',
      password: 'admin123',
      firstName: 'Admin',
      lastName: 'User',
      role: 'admin'
    };
    
    // Check if admin user already exists
    const existingAdmin = await pool.request()
      .input('email', sql.NVarChar, adminUser.email)
      .query('SELECT * FROM Users WHERE email = @email');
    
    if (existingAdmin.recordset.length > 0) {
      console.log(`ℹ️  Admin user already exists: ${adminUser.email}`);
    } else {
      // Create admin user
      const hashedPassword = await bcrypt.hash(adminUser.password, 12);
      const userId = uuidv4();
      
      await pool.request()
        .input('id', sql.NVarChar, userId)
        .input('firstName', sql.NVarChar, adminUser.firstName)
        .input('lastName', sql.NVarChar, adminUser.lastName)
        .input('email', sql.NVarChar, adminUser.email)
        .input('password', sql.NVarChar, hashedPassword)
        .input('provider', sql.NVarChar, 'local')
        .input('role', sql.NVarChar, adminUser.role)
        .query(`
          INSERT INTO Users (id, firstName, lastName, email, password, provider, role)
          VALUES (@id, @firstName, @lastName, @email, @password, @provider, @role)
        `);
      
      console.log(`✅ Created admin user: ${adminUser.email}`);
    }
    
    // List all users
    console.log('\n📋 All users in database:');
    const allUsers = await pool.request().query('SELECT id, firstName, lastName, email, provider, role, createdAt FROM Users');
    console.table(allUsers.recordset);
    
    console.log('\n✅ Test users creation completed successfully');
    
  } catch (error) {
    console.error('❌ Test user creation failed:', error);
    process.exit(1);
  }
}

// Run the script
createTestUser();