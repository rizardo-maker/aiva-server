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

async function testLogin(email, password) {
  try {
    console.log(`Testing login for: ${email}`);
    console.log(`Password provided: ${password}`);
    
    // Connect to database
    await sql.connect(config);
    console.log('✅ Database connection successful!');
    
    // First, let's list all users to see what's in the database
    console.log('\n--- All users in database ---');
    const allUsersResult = await sql.query`SELECT id, firstName, lastName, email, provider, role FROM Users`;
    allUsersResult.recordset.forEach((user, index) => {
      console.log(`${index + 1}. ${user.email} (${user.firstName} ${user.lastName}) - ${user.provider} - ${user.role}`);
    });
    
    // Get user
    console.log(`\n--- Looking for user with email: ${email} ---`);
    const result = await sql.query`SELECT * FROM Users WHERE email = ${email}`;
    
    console.log(`Query returned ${result.recordset.length} record(s)`);
    
    if (result.recordset.length === 0) {
      console.log(`❌ Login failed: User not found for email ${email}`);
      await sql.close();
      return false;
    }
    
    const user = result.recordset[0];
    console.log(`✅ User found: ${user.firstName} ${user.lastName}`);
    console.log(`Provider: ${user.provider}`);
    console.log(`Role: ${user.role}`);
    console.log(`Has password: ${!!user.password}`);
    
    // If no password hash, this might be a Microsoft OAuth user
    if (!user.password) {
      console.log(`❌ Login failed: User ${email} has no password (likely OAuth user)`);
      console.log('Message: This account uses Microsoft login. Please sign in with Microsoft.');
      await sql.close();
      return false;
    }
    
    console.log(`Stored password hash: ${user.password}`);
    
    // Check password
    console.log(`Verifying password for user ${email}...`);
    const isValidPassword = await bcrypt.compare(password, user.password);
    
    if (!isValidPassword) {
      console.log(`❌ Login failed: Invalid password for user ${email}`);
      console.log('Message: Invalid email or password');
      await sql.close();
      return false;
    }
    
    console.log('✅ Password verification successful!');
    console.log('Login would be successful!');
    
    await sql.close();
    return true;
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
    try {
      await sql.close();
    } catch (closeError) {
      // Ignore close errors
    }
    return false;
  }
}

// Get credentials from command line arguments
const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.log('Usage: node test-login-simple.js <email> <password>');
  console.log('Example: node test-login-simple.js test@example.com password123');
  process.exit(1);
}

testLogin(email, password);