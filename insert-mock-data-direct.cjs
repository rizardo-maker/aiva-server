// Script to insert mock messages and message actions for existing user sudhenreddym@gmail.com
const sql = require('mssql');
const { v4: uuidv4 } = require('uuid');

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

async function insertMockMessages() {
  let pool;
  
  try {
    console.log('Connecting to database...');
    pool = await sql.connect(config);
    console.log('✅ Database connection successful!');
    
    // Check if user exists
    console.log('Checking if user exists...');
    const userResult = await pool.request()
      .input('email', sql.NVarChar, 'sudhenreddym@gmail.com')
      .query('SELECT id FROM Users WHERE email = @email');
    
    if (userResult.recordset.length === 0) {
      console.log('❌ User with email sudhenreddym@gmail.com not found in the database');
      return;
    }
    
    const userId = userResult.recordset[0].id;
    console.log(`✅ Found user with ID: ${userId}`);
    
    // Check if user has any workspaces
    console.log('Checking if user has workspaces...');
    const workspaceResult = await pool.request()
      .input('ownerId', sql.NVarChar, userId)
      .query('SELECT id FROM Workspaces WHERE ownerId = @ownerId');
    
    let workspaceId;
    if (workspaceResult.recordset.length === 0) {
      console.log('❌ No workspace found for user');
      console.log('Creating default workspace...');
      
      workspaceId = uuidv4();
      await pool.request()
        .input('id', sql.NVarChar, workspaceId)
        .input('name', sql.NVarChar, 'Personal Projects')
        .input('description', sql.NVarChar, 'Default workspace for personal projects')
        .input('ownerId', sql.NVarChar, userId)
        .input('color', sql.NVarChar, '#3B82F6')
        .query(`
          INSERT INTO Workspaces (id, name, description, ownerId, color)
          VALUES (@id, @name, @description, @ownerId, @color)
        `);
      
      console.log(`✅ Default workspace created with ID: ${workspaceId}`);
    } else {
      workspaceId = workspaceResult.recordset[0].id;
      console.log(`✅ Found workspace with ID: ${workspaceId}`);
    }
    
    // Check if user has any chats
    console.log('Checking if user has chats...');
    const chatResult = await pool.request()
      .input('userId', sql.NVarChar, userId)
      .query('SELECT id FROM Chats WHERE userId = @userId');
    
    let chatId;
    if (chatResult.recordset.length === 0) {
      console.log('❌ No chat found for user');
      console.log('Creating default chat...');
      
      chatId = uuidv4();
      await pool.request()
        .input('id', sql.NVarChar, chatId)
        .input('title', sql.NVarChar, 'Test Chat')
        .input('description', sql.NVarChar, 'Test chat for mock data')
        .input('userId', sql.NVarChar, userId)
        .input('workspaceId', sql.NVarChar, workspaceId)
        .query(`
          INSERT INTO Chats (id, title, description, userId, workspaceId)
          VALUES (@id, @title, @description, @userId, @workspaceId)
        `);
      
      console.log(`✅ Default chat created with ID: ${chatId}`);
    } else {
      chatId = chatResult.recordset[0].id;
      console.log(`✅ Found chat with ID: ${chatId}`);
    }
    
    // Insert messages
    console.log('Inserting mock messages...');
    
    const messageId1 = uuidv4();
    const messageId2 = uuidv4();
    
    // Insert user message
    await pool.request()
      .input('id', sql.NVarChar, messageId1)
      .input('chatId', sql.NVarChar, chatId)
      .input('userId', sql.NVarChar, userId)
      .input('content', sql.NVarChar, 'Hello, this is a test message from Sudhen!')
      .input('role', sql.NVarChar, 'user')
      .query(`
        INSERT INTO Messages (id, chatId, userId, content, role, createdAt)
        VALUES (@id, @chatId, @userId, @content, @role, GETUTCDATE())
      `);
    
    console.log(`✅ User message created with ID: ${messageId1}`);
    
    // Insert AI response message
    await pool.request()
      .input('id', sql.NVarChar, messageId2)
      .input('chatId', sql.NVarChar, chatId)
      .input('userId', sql.NVarChar, userId)
      .input('content', sql.NVarChar, 'Hello Sudhen! This is a response from AIVA. How can I assist you today? This message has been liked and bookmarked for testing purposes.')
      .input('role', sql.NVarChar, 'assistant')
      .query(`
        INSERT INTO Messages (id, chatId, userId, content, role, createdAt)
        VALUES (@id, @chatId, @userId, @content, @role, GETUTCDATE())
      `);
    
    console.log(`✅ AI message created with ID: ${messageId2}`);
    
    // Insert message actions (like, bookmark) for the AI message
    console.log('Inserting message actions...');
    
    const actionId1 = uuidv4();
    await pool.request()
      .input('id', sql.NVarChar, actionId1)
      .input('messageId', sql.NVarChar, messageId2)
      .input('userId', sql.NVarChar, userId)
      .input('actionType', sql.NVarChar, 'like')
      .query(`
        INSERT INTO MessageActions (id, messageId, userId, actionType, createdAt)
        VALUES (@id, @messageId, @userId, @actionType, GETUTCDATE())
      `);
    
    console.log(`✅ Like action created with ID: ${actionId1}`);
    
    const actionId2 = uuidv4();
    await pool.request()
      .input('id', sql.NVarChar, actionId2)
      .input('messageId', sql.NVarChar, messageId2)
      .input('userId', sql.NVarChar, userId)
      .input('actionType', sql.NVarChar, 'bookmark')
      .query(`
        INSERT INTO MessageActions (id, messageId, userId, actionType, createdAt)
        VALUES (@id, @messageId, @userId, @actionType, GETUTCDATE())
      `);
    
    console.log(`✅ Bookmark action created with ID: ${actionId2}`);
    
    // Update chat message count
    await pool.request()
      .input('chatId', sql.NVarChar, chatId)
      .query(`
        UPDATE Chats 
        SET messageCount = 2, lastMessageAt = GETUTCDATE(), updatedAt = GETUTCDATE()
        WHERE id = @chatId
      `);
    
    console.log('✅ Chat message count updated');
    
    console.log('\n🎉 All mock data inserted successfully!');
    console.log('Messages inserted:');
    console.log(`  1. User message ID: ${messageId1}`);
    console.log(`  2. AI message ID: ${messageId2}`);
    console.log('Message actions inserted:');
    console.log(`  1. Like action ID: ${actionId1}`);
    console.log(`  2. Bookmark action ID: ${actionId2}`);
    console.log('\nYou should now be able to log in as sudhenreddym@gmail.com with password123');
    console.log('and see the mock messages and actions in the frontend.');
    
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

insertMockMessages();