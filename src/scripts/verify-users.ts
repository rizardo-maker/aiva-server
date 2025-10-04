import dotenv from 'dotenv';
import { DatabaseManager } from '../config/database';
import { logger } from '../utils/logger';
import * as sql from 'mssql';

// Load environment variables
dotenv.config({ path: '.env' });

async function verifyUsers() {
  try {
    logger.info('🔍 Verifying users in database...');
    
    const dbManager = DatabaseManager.getInstance();
    const pool = await dbManager.getPool();
    
    const targetEmails = [
      'sudhenreddym@gmail.com',
      'aiva50543@gmail.com', 
      'jacinthgilbert2006@gmail.com'
    ];
    
    logger.info('📋 Checking for target users:');
    
    for (const email of targetEmails) {
      const result = await pool.request()
        .input('email', sql.NVarChar, email)
        .query('SELECT id, firstName, lastName, email, role, provider, isActive, createdAt FROM Users WHERE email = @email');
      
      if (result.recordset.length > 0) {
        const user = result.recordset[0];
        logger.info(`✅ Found: ${user.firstName} ${user.lastName} (${user.email}) - Role: ${user.role}, ID: ${user.id}`);
      } else {
        logger.warn(`❌ Not found: ${email}`);
      }
    }
    
    // Get all users for admin API
    logger.info('\n📊 Testing admin users query...');
    const adminResult = await pool.request()
      .input('limit', sql.Int, 20)
      .input('offset', sql.Int, 0)
      .input('search', sql.NVarChar, '')
      .query(`
        SELECT 
          u.*,
          COUNT(c.id) as chatCount,
          COUNT(m.id) as messageCount,
          MAX(u.lastLoginAt) as lastLogin
        FROM Users u
        LEFT JOIN Chats c ON u.id = c.userId
        LEFT JOIN Messages m ON u.id = m.userId
        GROUP BY u.id, u.firstName, u.lastName, u.email, u.provider, u.providerId, 
                 u.avatar, u.preferences, u.isActive, u.lastLoginAt, u.createdAt, u.updatedAt, u.role
        ORDER BY u.createdAt DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `);
    
    logger.info(`📈 Admin query returned ${adminResult.recordset.length} users`);
    
    if (adminResult.recordset.length > 0) {
      logger.info('📋 Sample users from admin query:');
      adminResult.recordset.slice(0, 5).forEach((user, index) => {
        logger.info(`${index + 1}. ${user.firstName} ${user.lastName} (${user.email}) - Role: ${user.role}`);
      });
    }
    
    // Test count query
    const countResult = await pool.request()
      .input('search', sql.NVarChar, '')
      .query('SELECT COUNT(*) as total FROM Users u');
    
    logger.info(`📊 Total users in database: ${countResult.recordset[0].total}`);
    
    logger.info('\n✅ User verification completed!');
    
  } catch (error) {
    logger.error('❌ User verification failed:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

// Run the script
verifyUsers();
