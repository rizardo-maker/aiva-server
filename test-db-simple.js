require('dotenv').config();
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

async function testDB() {
  let pool;
  
  try {
    console.log('Testing database connection...');
    console.log('Server:', config.server);
    console.log('Database:', config.database);
    console.log('User:', config.user);
    
    // Connect to database
    pool = await sql.connect(config);
    console.log('✅ Database connection successful!');
    
    // Test a simple query
    console.log('Running simple query...');
    const result = await pool.request().query('SELECT 1 as test');
    console.log('Query result:', result.recordset);
    
    await sql.close();
    return true;
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
    if (pool) {
      await sql.close();
    }
    return false;
  }
}

testDB();