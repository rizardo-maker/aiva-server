import dotenv from 'dotenv';
import { DatabaseManager } from '../config/database';
import { logger } from '../utils/logger';
import * as sql from 'mssql';
import bcrypt from 'bcryptjs';

// Load environment variables
dotenv.config({ path: '.env' });

async function checkAdminLogin() {
  try {
    logger.info('🔍 Checking admin login credentials...');
    
    const dbManager = DatabaseManager.getInstance();
    const pool = await dbManager.getPool();
    
    // Check admin user
    const adminUser = await pool.request()
      .input('email', sql.NVarChar, 'sudhenreddym@gmail.com')
      .query('SELECT id, firstName, lastName, email, password, role FROM Users WHERE email = @email');
    
    if (adminUser.recordset.length === 0) {
      console.log('❌ Admin user not found!');
      return;
    }
    
    const user = adminUser.recordset[0];
    console.log('✅ Admin user found:');
    console.log('- ID:', user.id);
    console.log('- Name:', user.firstName, user.lastName);
    console.log('- Email:', user.email);
    console.log('- Role:', user.role);
    console.log('- Has Password:', !!user.password);
    
    // Test password verification
    if (user.password) {
      console.log('\n🔐 Testing passwords...');
      
      const passwords = ['TempPassword123!', 'admin123', 'password123'];
      
      for (const pwd of passwords) {
        try {
          const isValid = await bcrypt.compare(pwd, user.password);
          console.log(`- ${pwd}: ${isValid ? '✅ VALID' : '❌ Invalid'}`);
        } catch (error) {
          console.log(`- ${pwd}: ❌ Error testing`);
        }
      }
    } else {
      console.log('❌ User has no password set!');
    }
    
    console.log('\n🧪 Testing login API...');
    
    // Test the login API endpoint
    const testPasswords = ['TempPassword123!', 'admin123'];
    
    for (const pwd of testPasswords) {
      try {
        const response = await fetch('http://localhost:3001/api/auth/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: 'sudhenreddym@gmail.com',
            password: pwd
          })
        });
        
        const result: any = await response.json();
        
        if (response.ok) {
          console.log(`✅ API Login SUCCESS with ${pwd}`);
          console.log('- User:', result.user?.firstName, result.user?.lastName);
          console.log('- Role:', result.user?.role);
          console.log('- Token:', result.token ? 'Present' : 'Missing');
        } else {
          console.log(`❌ API Login FAILED with ${pwd}: ${result.message || result.error}`);
        }
      } catch (error) {
        console.log(`❌ API Login ERROR with ${pwd}:`, (error as Error).message);
      }
    }
    
  } catch (error) {
    console.error('❌ Script error:', error);
  } finally {
    process.exit(0);
  }
}

// Run the script
checkAdminLogin();
