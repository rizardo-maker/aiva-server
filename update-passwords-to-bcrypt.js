require('dotenv').config();
const sql = require('mssql');
const bcrypt = require('bcryptjs');

// Database configuration from environment variables
const config = {
  user: process.env.SQL_USERNAME || 'aivadbadmin',
  password: process.env.SQL_PASSWORD || 'ravi@0791',
  server: process.env.SQL_SERVER || 'aivaserver.database.windows.net',
  database: process.env.SQL_DATABASE || 'aivadb',
  options: {
    encrypt: true,
    trustServerCertificate: false,
    requestTimeout: 30000,
    connectionTimeout: 15000
  }
};

async function updatePasswordsToBcrypt() {
  let pool;
  
  try {
    console.log('Updating plaintext passwords to bcrypt hashes...');
    
    // Connect to database
    pool = await sql.connect(config);
    console.log('✅ Database connection successful!');
    
    // Get all users with plaintext passwords
    const result = await pool.request().query(`
      SELECT 
        id, 
        firstName, 
        lastName, 
        email, 
        password
      FROM Users
      WHERE password IS NOT NULL 
        AND password != '' 
        AND password NOT LIKE '$2a$%'
    `);
    
    console.log(`Found ${result.recordset.length} users with plaintext passwords`);
    
    if (result.recordset.length === 0) {
      console.log('No plaintext passwords found. All passwords are already hashed or empty.');
      await sql.close();
      return;
    }
    
    // Update each user's password to bcrypt hash
    for (const user of result.recordset) {
      console.log(`\nProcessing user: ${user.email} (${user.firstName} ${user.lastName})`);
      console.log(`Current password: ${user.password}`);
      
      // Hash the password with bcrypt (12 rounds)
      const hashedPassword = await bcrypt.hash(user.password, 12);
      console.log(`Bcrypt hash: ${hashedPassword}`);
      
      // Update the user's password in the database
      await pool.request()
        .input('id', sql.NVarChar, user.id)
        .input('password', sql.NVarChar, hashedPassword)
        .query('UPDATE Users SET password = @password WHERE id = @id');
      
      console.log(`✅ Password updated for ${user.email}`);
    }
    
    // Verify the updates
    console.log('\nVerifying updates...');
    const verificationResult = await pool.request().query(`
      SELECT 
        id, 
        firstName, 
        lastName, 
        email, 
        CASE 
          WHEN password IS NULL THEN 'NULL'
          WHEN password = '' THEN 'EMPTY'
          WHEN password LIKE '$2a$%' THEN 'BCRYPT'
          ELSE 'PLAINTEXT'
        END as passwordStatus
      FROM Users
      WHERE password IS NOT NULL 
        AND password != '' 
        AND password LIKE '$2a$%'
    `);
    
    console.log('\nVerification Results:');
    console.log('====================');
    verificationResult.recordset.forEach(user => {
      console.log(`${user.email}: BCRYPT`);
    });
    
    console.log('\n✅ All plaintext passwords have been updated to bcrypt hashes!');
    
    await sql.close();
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (pool) {
      await sql.close();
    }
  }
}

updatePasswordsToBcrypt();