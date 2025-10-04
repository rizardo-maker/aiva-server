import dotenv from 'dotenv';
import path from 'path';
import { DatabaseManager } from '../config/database';
import sql from 'mssql';

// Load environment variables from the server directory
const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });
console.log('🔧 Environment loaded from:', envPath);

async function updateUserName() {
  try {
    console.log('🔄 Updating AIVA Developer user name to Aiva App...');
    const dbManager = DatabaseManager.getInstance();
    const pool = await dbManager.getPool();

    // Update the AIVA Developer user to Aiva App
    const updateResult = await pool.request()
      .input('userId', sql.NVarChar, 'd9a840e7-d373-4473-a853-0e826680f433')
      .input('firstName', sql.NVarChar, 'Aiva')
      .input('lastName', sql.NVarChar, 'App')
      .query(`
        UPDATE Users 
        SET firstName = @firstName, lastName = @lastName, updatedAt = GETDATE()
        WHERE id = @userId
      `);

    console.log(`✅ Updated ${updateResult.rowsAffected[0]} user record`);

    // Verify the update
    const verifyResult = await pool.request()
      .input('userId', sql.NVarChar, 'd9a840e7-d373-4473-a853-0e826680f433')
      .query('SELECT id, firstName, lastName, email FROM Users WHERE id = @userId');

    if (verifyResult.recordset.length > 0) {
      const user = verifyResult.recordset[0];
      console.log(`✅ Verified: ${user.firstName} ${user.lastName} (${user.email})`);
    }

    console.log('🎉 User name update completed successfully!');
  } catch (error) {
    console.error('❌ Update failed:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error details:', errorMessage);
  } finally {
    process.exit(0);
  }
}

updateUserName();
