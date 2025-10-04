// Script to verify that mock data can be retrieved from the database
const sql = require('mssql');

// Database configuration from .env file
const config = {
  server: 'aivaserver.database.windows.net',
  database: 'aivadb',
  user: 'aivadbadmin',
  password: 'ravi@0791',
  options: {
    encrypt: true,
    trustServerCertificate: false,
    requestTimeout: 30000,
    connectionTimeout: 15000
  }
};

async function verifyMockData() {
  let pool;
  
  try {
    console.log('Connecting to database...');
    pool = await sql.connect(config);
    console.log('✅ Database connection successful!');
    
    // Find the user
    console.log('Finding user sudhenreddym@gmail.com...');
    const userResult = await pool.request()
      .input('email', sql.NVarChar, 'sudhenreddym@gmail.com')
      .query('SELECT id, firstName, lastName, email FROM Users WHERE email = @email');
    
    if (userResult.recordset.length === 0) {
      console.log('❌ User with email sudhenreddym@gmail.com not found in the database');
      return;
    }
    
    const userId = userResult.recordset[0].id;
    console.log(`✅ Found user: ${userResult.recordset[0].firstName} ${userResult.recordset[0].lastName} (${userResult.recordset[0].email})`);
    
    // Find user's chats
    console.log('\nFinding user chats...');
    const chatResult = await pool.request()
      .input('userId', sql.NVarChar, userId)
      .query('SELECT id, title, messageCount FROM Chats WHERE userId = @userId');
    
    if (chatResult.recordset.length === 0) {
      console.log('❌ No chats found for user');
      return;
    }
    
    const chat = chatResult.recordset[0];
    console.log(`✅ Found chat: ${chat.title} (ID: ${chat.id}) with ${chat.messageCount} messages`);
    
    // Find messages in the chat
    console.log('\nFinding messages in chat...');
    const messagesResult = await pool.request()
      .input('chatId', sql.NVarChar, chat.id)
      .query('SELECT id, content, role, createdAt FROM Messages WHERE chatId = @chatId ORDER BY createdAt');
    
    if (messagesResult.recordset.length === 0) {
      console.log('❌ No messages found in chat');
      return;
    }
    
    console.log(`✅ Found ${messagesResult.recordset.length} messages:`);
    messagesResult.recordset.forEach((message, index) => {
      console.log(`  ${index + 1}. [${message.role}] ${message.content.substring(0, 50)}...`);
    });
    
    // Find message actions
    console.log('\nFinding message actions...');
    const actionsResult = await pool.request()
      .input('userId', sql.NVarChar, userId)
      .query('SELECT messageId, actionType, createdAt FROM MessageActions WHERE userId = @userId ORDER BY createdAt');
    
    if (actionsResult.recordset.length === 0) {
      console.log('❌ No message actions found for user');
    } else {
      console.log(`✅ Found ${actionsResult.recordset.length} message actions:`);
      actionsResult.recordset.forEach((action, index) => {
        console.log(`  ${index + 1}. ${action.actionType} on message ${action.messageId.substring(0, 8)}...`);
      });
    }
    
    console.log('\n🎉 Verification complete! All mock data is retrievable from the database.');
    console.log('The frontend should now be able to retrieve this data when you log in as sudhenreddym@gmail.com with password123.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    if (pool) {
      await pool.close();
      console.log('Database connection closed');
    }
  }
}

verifyMockData();