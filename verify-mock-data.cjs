// Script to verify mock data in the database
const { DatabaseManager } = require('./dist/config/database');
const sql = require('mssql');

async function verifyMockData() {
  let dbManager;
  
  try {
    console.log('Initializing database manager...');
    
    // Initialize database manager
    dbManager = DatabaseManager.getInstance();
    const pool = await dbManager.getPool();
    console.log('✅ Database connection successful!');
    
    // Check if user exists
    const userResult = await pool.request()
      .input('email', sql.NVarChar, 'sudhenreddym@gmail.com')
      .query('SELECT id, firstName, lastName FROM Users WHERE email = @email');
    
    if (userResult.recordset.length === 0) {
      console.log('❌ User with email sudhenreddym@gmail.com not found in the database');
      await dbManager.disconnect();
      return;
    }
    
    const user = userResult.recordset[0];
    console.log(`✅ Found user: ${user.firstName} ${user.lastName} (ID: ${user.id})`);
    
    // Check if user has any chats
    const chatResult = await pool.request()
      .input('userId', sql.NVarChar, user.id)
      .query('SELECT id, title, messageCount FROM Chats WHERE userId = @userId');
    
    if (chatResult.recordset.length === 0) {
      console.log('❌ No chats found for user');
      await dbManager.disconnect();
      return;
    }
    
    const chat = chatResult.recordset[0];
    console.log(`✅ Found chat: ${chat.title} (ID: ${chat.id}) with ${chat.messageCount} messages`);
    
    // Get messages for this chat
    const messagesResult = await pool.request()
      .input('chatId', sql.NVarChar, chat.id)
      .query('SELECT id, content, role, createdAt FROM Messages WHERE chatId = @chatId ORDER BY createdAt ASC');
    
    console.log(`\n📝 Messages in chat (${messagesResult.recordset.length} found):`);
    messagesResult.recordset.forEach((message, index) => {
      console.log(`  ${index + 1}. ${message.role === 'user' ? 'User' : 'AI'}: ${message.content.substring(0, 50)}${message.content.length > 50 ? '...' : ''}`);
      console.log(`     ID: ${message.id}`);
      console.log(`     Created: ${message.createdAt}`);
    });
    
    // Get message actions
    const actionsResult = await pool.request()
      .input('userId', sql.NVarChar, user.id)
      .query(`
        SELECT ma.id, ma.messageId, ma.actionType, ma.createdAt, m.content
        FROM MessageActions ma
        JOIN Messages m ON ma.messageId = m.id
        WHERE ma.userId = @userId
        ORDER BY ma.createdAt ASC
      `);
    
    console.log(`\n⚡ Message actions (${actionsResult.recordset.length} found):`);
    actionsResult.recordset.forEach((action, index) => {
      console.log(`  ${index + 1}. ${action.actionType} on message: ${action.content.substring(0, 30)}${action.content.length > 30 ? '...' : ''}`);
      console.log(`     Action ID: ${action.id}`);
      console.log(`     Message ID: ${action.messageId}`);
      console.log(`     Created: ${action.createdAt}`);
    });
    
    await dbManager.disconnect();
    return true;
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (dbManager) {
      await dbManager.disconnect();
    }
    return false;
  }
}

verifyMockData();