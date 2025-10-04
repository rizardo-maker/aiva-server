const sql = require('mssql');

// Database configuration from .env
const config = {
  user: 'aivadbadmin',
  password: 'ravi@0791',
  server: 'aivaserver.database.windows.net',
  database: 'aivadb',
  options: {
    encrypt: true,
    trustServerCertificate: false
  }
};

async function testMessageActions() {
  try {
    console.log('Connecting to database...');
    const pool = await sql.connect(config);
    console.log('✅ Connected successfully');

    // Get an existing message ID (assistant message)
    const messageResult = await pool.request()
      .query("SELECT TOP 1 id FROM Messages WHERE role = 'assistant' ORDER BY createdAt DESC");
    
    if (messageResult.recordset.length === 0) {
      console.log('No messages found in database');
      await sql.close();
      return;
    }
    
    const messageId = messageResult.recordset[0].id;
    const userId = '45F04D58-FA50-49AA-8820-CD548D25CD39'; // Using existing user ID
    console.log(`Testing message actions with message ID: ${messageId}`);
    
    // First remove any existing action
    await pool.request()
      .input('messageId', messageId)
      .input('userId', userId)
      .input('actionType', 'like')
      .query(`
        DELETE FROM MessageActions 
        WHERE messageId = @messageId AND userId = @userId AND actionType = @actionType
      `);
    
    // Test adding a like action
    const actionId = 'test-action-' + Date.now();
    await pool.request()
      .input('id', actionId)
      .input('messageId', messageId)
      .input('userId', userId)
      .input('actionType', 'like')
      .query(`
        INSERT INTO MessageActions (id, messageId, userId, actionType)
        VALUES (@id, @messageId, @userId, @actionType)
      `);
    
    console.log('✅ Like action added successfully');
    
    // Verify the action was added
    const verifyResult = await pool.request()
      .input('messageId', messageId)
      .input('userId', userId)
      .input('actionType', 'like')
      .query(`
        SELECT * FROM MessageActions 
        WHERE messageId = @messageId AND userId = @userId AND actionType = @actionType
      `);
    
    console.log('Verified action exists:', verifyResult.recordset.length > 0);
    
    // Test removing the action
    await pool.request()
      .input('messageId', messageId)
      .input('userId', userId)
      .input('actionType', 'like')
      .query(`
        DELETE FROM MessageActions 
        WHERE messageId = @messageId AND userId = @userId AND actionType = @actionType
      `);
    
    console.log('✅ Like action removed successfully');
    
    // Close connection
    await sql.close();
    console.log('✅ Message actions test completed successfully');
    
  } catch (error) {
    console.error('❌ Message actions test failed:', error.message);
  }
}

testMessageActions();