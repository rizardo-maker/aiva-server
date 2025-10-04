import dotenv from 'dotenv';
import { DatabaseManager } from '../config/database';
import { logger } from '../utils/logger';
import * as sql from 'mssql';
import bcrypt from 'bcryptjs';

// Load environment variables
dotenv.config({ path: '.env' });

async function checkUserPassword() {
  try {
    logger.info('🔍 Checking user password...');
    
    const dbManager = DatabaseManager.getInstance();
    const pool = await dbManager.getPool();
    
    const user = await pool.request()
      .input('email', sql.NVarChar, 'aiva50543@gmail.com')
      .query('SELECT password, provider FROM Users WHERE email = @email');
    
    if (user.recordset.length > 0) {
      const userData = user.recordset[0];
      console.log('🔐 Password info for aiva50543@gmail.com:');
      console.log('- Has password:', !!userData.password);
      console.log('- Provider:', userData.provider);
      
      if (userData.password) {
        console.log('- Password length:', userData.password.length);
        console.log('- Starts with $2:', userData.password.startsWith('$2'));
        
        // Test common passwords
        const passwords = ['TempPassword123!', 'password123', 'aiva123'];
        console.log('\n🧪 Testing passwords:');
        
        for (const pwd of passwords) {
          try {
            const isValid = await bcrypt.compare(pwd, userData.password);
            console.log(`- ${pwd}: ${isValid ? '✅ VALID' : '❌ Invalid'}`);
          } catch (error) {
            console.log(`- ${pwd}: ❌ Error testing`);
          }
        }
      } else {
        console.log('- No password set (likely OAuth user)');
        
        // Set a password for this user
        console.log('\n🔧 Setting password for user...');
        const newPassword = 'TempPassword123!';
        const hashedPassword = await bcrypt.hash(newPassword, 12);
        
        await pool.request()
          .input('email', sql.NVarChar, 'aiva50543@gmail.com')
          .input('password', sql.NVarChar, hashedPassword)
          .input('updatedAt', sql.DateTime, new Date())
          .query('UPDATE Users SET password = @password, updatedAt = @updatedAt WHERE email = @email');
        
        console.log('✅ Password set successfully');
        console.log('- New password:', newPassword);
      }
    } else {
      console.log('❌ User not found');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    process.exit(0);
  }
}

// Run the script
checkUserPassword();
