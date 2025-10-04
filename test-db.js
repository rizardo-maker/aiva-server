const sql = require('mssql');

// Database configuration from .env
const config = {
  server: 'aivaserver.database.windows.net',
  database: 'aivadb',
  user: 'aivadbadmin',
  password: 'ravi@0791',
  options: {
    encrypt: true,
    trustServerCertificate: false
  }
};

async function testConnection() {
  try {
    console.log('Connecting to database...');
    await sql.connect(config);
    console.log('✅ Connected successfully!');
    
    // Query to check users
    const result = await sql.query`SELECT id, firstName, lastName, email, provider, role FROM Users`;
    console.log('\n📋 Users in database:');
    console.table(result.recordset);
    
    await sql.close();
  } catch (err) {
    console.error('❌ Database error:', err);
  }
}

testConnection();