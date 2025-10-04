require('dotenv').config();
const sql = require('mssql');
const bcrypt = require('bcryptjs');

async function updateAllPlaintextPasswords() {
  let pool;
  
  try {
    console.log('Updating all plaintext passwords to bcrypt hashes...');
    
    // Database configuration
    const config = {
      user: process.env.SQL_USERNAME,
      password: process.env.SQL_PASSWORD,
      server: process.env.SQL_SERVER,
      database: process.env.SQL_DATABASE,
      options: {
        encrypt: true,
        trustServerCertificate: false,
        requestTimeout: 30000,
        connectionTimeout: 15000
      }
    };
    
    // Connect to database
    pool = await sql.connect(config);
    console.log('✅ Connected to database');
    
    // Get all users with plaintext passwords
    console.log('Finding users with plaintext passwords...');
    const result = await pool.request().query(`
      SELECT id, firstName, lastName, email, password
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
    
    // Update each user's password
    for (let i = 0; i < result.recordset.length; i++) {
      const user = result.recordset[i];
      console.log(`\n[${i+1}/${result.recordset.length}] Processing ${user.email}...`);
      
      try {
        // Hash the password
        const hashedPassword = await bcrypt.hash(user.password, 12);
        console.log(`  Plain: ${user.password}`);
        console.log(`  Hash:  ${hashedPassword}`);
        
        // Update in database
        await pool.request()
          .input('id', sql.NVarChar, user.id)
          .input('password', sql.NVarChar, hashedPassword)
          .query('UPDATE Users SET password = @password WHERE id = @id');
        
        console.log(`  ✅ Updated successfully`);
      } catch (userError) {
        console.error(`  ❌ Failed to update ${user.email}:`, userError.message);
      }
    }
    
    // Final verification
    console.log('\nVerifying updates...');
    const verifyResult = await pool.request().query(`
      SELECT 
        email,
        firstName,
        lastName,
        CASE 
          WHEN password IS NULL THEN 'NULL'
          WHEN password = '' THEN 'EMPTY'
          WHEN password LIKE '$2a$%' THEN 'BCRYPT'
          ELSE 'PLAINTEXT'
        END as passwordStatus
      FROM Users
      ORDER BY email
    `);
    
    console.log('\nFinal Status Check:');
    console.log('===================');
    let bcryptCount = 0;
    let plaintextCount = 0;
    let nullCount = 0;
    let emptyCount = 0;
    
    verifyResult.recordset.forEach(user => {
      console.log(`${user.email}: ${user.passwordStatus}`);
      
      switch (user.passwordStatus) {
        case 'BCRYPT': bcryptCount++; break;
        case 'PLAINTEXT': plaintextCount++; break;
        case 'NULL': nullCount++; break;
        case 'EMPTY': emptyCount++; break;
      }
    });
    
    console.log('\nSummary:');
    console.log('========');
    console.log(`BCRYPT: ${bcryptCount} users`);
    console.log(`PLAINTEXT: ${plaintextCount} users`);
    console.log(`NULL: ${nullCount} users`);
    console.log(`EMPTY: ${emptyCount} users`);
    
    if (plaintextCount === 0) {
      console.log('\n🎉 All passwords are now securely hashed with bcrypt!');
    } else {
      console.log(`\n⚠️  ${plaintextCount} users still have plaintext passwords that need to be updated.`);
    }
    
    await sql.close();
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (pool) {
      try {
        await sql.close();
      } catch (closeError) {
        console.error('Error closing connection:', closeError.message);
      }
    }
  }
}

updateAllPlaintextPasswords();