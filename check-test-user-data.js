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

async function checkTestData() {
  let pool;
  
  try {
    console.log('Connecting to database...');
    console.log('Server:', config.server);
    console.log('Database:', config.database);
    console.log('User:', config.user);
    
    // Connect to database
    pool = await sql.connect(config);
    console.log('✅ Database connection successful!');
    
    // Check if test user exists
    console.log('\n--- Checking for test user (user1) ---');
    const userCheck = await pool.request()
      .input('userId', sql.NVarChar, 'user1')
      .query('SELECT * FROM Users WHERE id = @userId');
    
    if (userCheck.recordset.length > 0) {
      console.log('✅ Test user found:');
      console.log(userCheck.recordset[0]);
    } else {
      console.log('❌ Test user (user1) not found');
    }
    
    // Check if sudhen user exists
    console.log('\n--- Checking for sudhen user ---');
    const sudhenUserCheck = await pool.request()
      .input('email', sql.NVarChar, 'sudhenreddym@gmail.com')
      .query('SELECT * FROM Users WHERE email = @email');
    
    if (sudhenUserCheck.recordset.length > 0) {
      console.log('✅ Sudhen user found:');
      console.log(sudhenUserCheck.recordset[0]);
    } else {
      console.log('❌ Sudhen user not found');
    }
    
    // Check chats for test user
    console.log('\n--- Checking chats for test user ---');
    const chatCheck = await pool.request()
      .input('userId', sql.NVarChar, 'user1')
      .query('SELECT * FROM Chats WHERE userId = @userId');
    
    if (chatCheck.recordset.length > 0) {
      console.log(`✅ Found ${chatCheck.recordset.length} chat(s) for test user:`);
      chatCheck.recordset.forEach(chat => {
        console.log(`  - Chat ID: ${chat.id}, Title: ${chat.title}`);
      });
    } else {
      console.log('❌ No chats found for test user');
    }
    
    // Check messages for test user
    console.log('\n--- Checking messages for test user ---');
    const messageCheck = await pool.request()
      .input('userId', sql.NVarChar, 'user1')
      .query('SELECT * FROM Messages WHERE userId = @userId');
    
    if (messageCheck.recordset.length > 0) {
      console.log(`✅ Found ${messageCheck.recordset.length} message(s) for test user:`);
      messageCheck.recordset.forEach(msg => {
        console.log(`  - Message ID: ${msg.id}, Role: ${msg.role}, Content: ${msg.content.substring(0, 50)}...`);
      });
    } else {
      console.log('❌ No messages found for test user');
    }
    
    // Check message actions for test user
    console.log('\n--- Checking message actions for test user ---');
    const actionCheck = await pool.request()
      .input('userId', sql.NVarChar, 'user1')
      .query('SELECT * FROM MessageActions WHERE userId = @userId');
    
    if (actionCheck.recordset.length > 0) {
      console.log(`✅ Found ${actionCheck.recordset.length} message action(s) for test user:`);
      actionCheck.recordset.forEach(action => {
        console.log(`  - Action ID: ${action.id}, Message ID: ${action.messageId}, Type: ${action.actionType}`);
      });
    } else {
      console.log('❌ No message actions found for test user');
    }
    
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

checkTestData();