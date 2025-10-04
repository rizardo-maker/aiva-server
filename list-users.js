const sql = require('mssql');

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

async function listUsers() {
  try {
    console.log('Connecting to database...');
    
    // Connect to database
    await sql.connect(config);
    console.log('✅ Database connection successful!');
    
    // List all users
    const result = await sql.query`SELECT id, firstName, lastName, email, provider, role, createdAt FROM Users`;
    
    if (result.recordset.length === 0) {
      console.log('No users found in database');
    } else {
      console.log(`Found ${result.recordset.length} user(s):`);
      console.table(result.recordset);
    }
    
    await sql.close();
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

listUsers();