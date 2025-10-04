const sql = require('mssql');
require('dotenv').config();

// Database configuration
const config = {
  user: process.env.SQL_USERNAME,
  password: process.env.SQL_PASSWORD,
  server: process.env.SQL_SERVER,
  database: process.env.SQL_DATABASE,
  options: {
    encrypt: process.env.SQL_ENCRYPT === 'true',
    trustServerCertificate: process.env.SQL_TRUST_SERVER_CERTIFICATE === 'true'
  }
};

async function testDatabase() {
  try {
    console.log('Connecting to database...');
    await sql.connect(config);
    console.log('✅ Connected successfully');

    // Test querying existing data
    console.log('\n--- Testing Existing Data ---');
    
    // Check users
    const userResult = await sql.query`SELECT COUNT(*) as count FROM Users`;
    console.log('Users in database:', userResult.recordset[0].count);
    
    // Check workspaces
    const workspaceResult = await sql.query`SELECT COUNT(*) as count FROM Workspaces`;
    console.log('Workspaces in database:', workspaceResult.recordset[0].count);
    
    // Check chats
    const chatResult = await sql.query`SELECT COUNT(*) as count FROM Chats`;
    console.log('Chats in database:', chatResult.recordset[0].count);
    
    // Check messages
    const messageResult = await sql.query`SELECT COUNT(*) as count FROM Messages`;
    console.log('Messages in database:', messageResult.recordset[0].count);
    
    // Check message actions
    const actionResult = await sql.query`SELECT COUNT(*) as count FROM MessageActions`;
    console.log('Message actions in database:', actionResult.recordset[0].count);
    
    console.log('\n✅ Database test completed successfully');
    
    // Close connection
    await sql.close();
  } catch (error) {
    console.error('❌ Database test failed:', error.message);
  }
}

testDatabase();