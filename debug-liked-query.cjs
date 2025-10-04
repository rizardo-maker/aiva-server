const sql = require('mssql');
require('dotenv').config();

// Direct database configuration
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

async function debugLikedMessagesQuery() {
  console.log('🔍 Debugging liked messages query...');
  
  let pool;
  try {
    // Connect to database
    pool = await sql.connect(config);
    console.log('✅ Database connection successful!');
    
    // Find the user
    const userResult = await pool.request()
      .input('email', sql.NVarChar, 'sudhenreddym@gmail.com')
      .query('SELECT id, firstName, lastName, email FROM Users WHERE email = @email');
    
    if (userResult.recordset.length === 0) {
      console.log('❌ User not found');
      return;
    }
    
    const user = userResult.recordset[0];
    console.log(`✅ Found user: ${user.firstName} ${user.lastName} (${user.email})`);
    console.log(`🆔 User ID: ${user.id}`);
    
    // Test the exact query from messageActions.ts
    console.log('\n🧪 Testing the exact query from messageActions.ts...');
    const result = await pool.request()
      .input('userId', sql.NVarChar, user.id)
      .query(`
        SELECT ma.*, m.content as messageContent, m.role as messageRole, m.createdAt as messageCreatedAt,
               c.title as chatTitle
        FROM MessageActions ma
        INNER JOIN Messages m ON ma.messageId = m.id
        INNER JOIN Chats c ON m.chatId = c.id
        WHERE ma.userId = @userId AND ma.actionType = 'like'
        ORDER BY ma.createdAt DESC
      `);
    
    console.log(`📋 Query returned ${result.recordset.length} records`);
    
    if (result.recordset.length > 0) {
      console.log('\n📄 First few records:');
      result.recordset.slice(0, 3).forEach((record, index) => {
        console.log(`  ${index + 1}. Message ID: ${record.messageId}`);
        console.log(`     Action Type: ${record.actionType}`);
        console.log(`     Message Content: ${record.messageContent ? record.messageContent.substring(0, 50) + '...' : 'N/A'}`);
        console.log(`     Chat Title: ${record.chatTitle || 'N/A'}`);
        console.log(`     Created At: ${record.messageCreatedAt || 'N/A'}`);
        console.log('');
      });
    } else {
      console.log('⚠️  No liked messages found with the current query');
      
      // Let's check if there are any MessageActions at all for this user
      console.log('\n🔍 Checking all MessageActions for this user...');
      const allActions = await pool.request()
        .input('userId', sql.NVarChar, user.id)
        .query(`
          SELECT ma.*, m.content as messageContent, m.role as messageRole, m.createdAt as messageCreatedAt,
                 c.title as chatTitle
          FROM MessageActions ma
          INNER JOIN Messages m ON ma.messageId = m.id
          INNER JOIN Chats c ON m.chatId = c.id
          WHERE ma.userId = @userId
          ORDER BY ma.createdAt DESC
        `);
      
      console.log(`📋 Total MessageActions for user: ${allActions.recordset.length}`);
      
      if (allActions.recordset.length > 0) {
        console.log('\n📄 Sample actions:');
        allActions.recordset.slice(0, 5).forEach((record, index) => {
          console.log(`  ${index + 1}. Action Type: ${record.actionType} | Message: ${record.messageContent ? record.messageContent.substring(0, 30) + '...' : 'N/A'}`);
        });
      }
      
      // Check if there are any messages without proper chat associations
      console.log('\n🔍 Checking for orphaned messages...');
      const orphanedActions = await pool.request()
        .input('userId', sql.NVarChar, user.id)
        .query(`
          SELECT ma.*
          FROM MessageActions ma
          LEFT JOIN Messages m ON ma.messageId = m.id
          LEFT JOIN Chats c ON m.chatId = c.id
          WHERE ma.userId = @userId AND (m.id IS NULL OR c.id IS NULL)
        `);
      
      console.log(`📋 Orphaned MessageActions: ${orphanedActions.recordset.length}`);
      
      // Check if there are any messages with chat associations but missing data
      console.log('\n🔍 Checking for messages with missing data...');
      const incompleteActions = await pool.request()
        .input('userId', sql.NVarChar, user.id)
        .query(`
          SELECT ma.id as actionId, ma.messageId, ma.actionType, ma.createdAt as actionCreatedAt,
                 m.id as messageId, m.content, m.role, m.createdAt as messageCreatedAt,
                 c.id as chatId, c.title
          FROM MessageActions ma
          INNER JOIN Messages m ON ma.messageId = m.id
          INNER JOIN Chats c ON m.chatId = c.id
          WHERE ma.userId = @userId
        `);
      
      console.log(`📋 MessageActions with complete data: ${incompleteActions.recordset.length}`);
      
      if (incompleteActions.recordset.length > 0) {
        console.log('\n📄 Sample complete data:');
        incompleteActions.recordset.slice(0, 3).forEach((record, index) => {
          console.log(`  ${index + 1}. Action: ${record.actionType}`);
          console.log(`     Message ID: ${record.messageId}`);
          console.log(`     Chat Title: ${record.title || 'N/A'}`);
          console.log(`     Content: ${record.content ? record.content.substring(0, 30) + '...' : 'N/A'}`);
          console.log('');
        });
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
  } finally {
    if (pool) {
      await pool.close();
    }
  }
}

debugLikedMessagesQuery();