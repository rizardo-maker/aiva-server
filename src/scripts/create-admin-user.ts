import dotenv from 'dotenv';
import { DatabaseManager } from '../config/database';
import { logger } from '../utils/logger';
import * as sql from 'mssql';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

// Load environment variables
dotenv.config({ path: '.env' });

async function createAdminUser() {
  try {
    logger.info('🔧 Creating/updating admin user...');
    
    const dbManager = DatabaseManager.getInstance();
    const pool = await dbManager.getPool();
    
    const adminEmail = 'sudhenreddym@gmail.com';
    const adminPassword = 'password123';
    const adminId = '7FC8F24A-5494-426C-93F2-61471A72D6AD';
    
    // Hash the password
    const hashedPassword = await bcrypt.hash(adminPassword, 12);
    
    // Check if admin user already exists
    const existingUser = await pool.request()
      .input('email', sql.NVarChar, adminEmail)
      .query('SELECT id, email, role FROM Users WHERE email = @email');
    
    if (existingUser.recordset.length > 0) {
      console.log('✅ Admin user already exists, updating password...');
      
      // Update existing user
      await pool.request()
        .input('email', sql.NVarChar, adminEmail)
        .input('password', sql.NVarChar, hashedPassword)
        .input('role', sql.NVarChar, 'admin')
        .input('updatedAt', sql.DateTime, new Date())
        .query(`
          UPDATE Users 
          SET password = @password, role = @role, updatedAt = @updatedAt
          WHERE email = @email
        `);
      
      console.log('✅ Admin user password updated successfully');
      
    } else {
      console.log('🆕 Creating new admin user...');
      
      // Create new admin user
      await pool.request()
        .input('id', sql.NVarChar, adminId)
        .input('firstName', sql.NVarChar, 'Admin')
        .input('lastName', sql.NVarChar, 'User')
        .input('email', sql.NVarChar, adminEmail)
        .input('password', sql.NVarChar, hashedPassword)
        .input('provider', sql.NVarChar, 'local')
        .input('role', sql.NVarChar, 'admin')
        .input('isActive', sql.Bit, true)
        .input('createdAt', sql.DateTime, new Date())
        .input('updatedAt', sql.DateTime, new Date())
        .query(`
          INSERT INTO Users (
            id, firstName, lastName, email, password, provider, role, isActive, createdAt, updatedAt
          ) VALUES (
            @id, @firstName, @lastName, @email, @password, @provider, @role, @isActive, @createdAt, @updatedAt
          )
        `);
      
      console.log('✅ New admin user created successfully');
    }
    
    // Verify the user was created/updated correctly
    const verifyUser = await pool.request()
      .input('email', sql.NVarChar, adminEmail)
      .query('SELECT id, firstName, lastName, email, role, isActive FROM Users WHERE email = @email');
    
    if (verifyUser.recordset.length > 0) {
      const user = verifyUser.recordset[0];
      console.log('✅ Admin user verification:');
      console.log('- ID:', user.id);
      console.log('- Name:', user.firstName, user.lastName);
      console.log('- Email:', user.email);
      console.log('- Role:', user.role);
      console.log('- Active:', user.isActive);
      
      // Test password verification
      const testUser = await pool.request()
        .input('email', sql.NVarChar, adminEmail)
        .query('SELECT password FROM Users WHERE email = @email');
      
      if (testUser.recordset.length > 0) {
        const isPasswordValid = await bcrypt.compare(adminPassword, testUser.recordset[0].password);
        console.log('- Password Valid:', isPasswordValid ? '✅ YES' : '❌ NO');
      }
      
    } else {
      console.log('❌ Failed to verify admin user creation');
    }
    
    console.log('\n🎯 Admin Credentials:');
    console.log('Email: sudhenreddym@gmail.com');
    console.log('Password: password123');
    console.log('Role: admin');
    
  } catch (error) {
    console.error('❌ Error creating admin user:', error);
  } finally {
    process.exit(0);
  }
}

// Run the script
createAdminUser();
