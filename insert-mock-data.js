require('dotenv').config();
const sql = require('mssql');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

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

async function insertMockData() {
  let pool;
  
  try {
    console.log('Connecting to database...');
    console.log('Server:', config.server);
    console.log('Database:', config.database);
    console.log('User:', config.user);
    
    // Connect to database
    pool = await sql.connect(config);
    console.log('✅ Database connection successful!');
    
    // Check if user already exists
    const userCheck = await pool.request()
      .input('email', sql.NVarChar, 'sudhenreddym@gmail.com')
      .query('SELECT id FROM Users WHERE email = @email');
    
    let userId;
    if (userCheck.recordset.length > 0) {
      userId = userCheck.recordset[0].id;
      console.log(`✅ User already exists with ID: ${userId}`);
    } else {
      // Create user
      userId = uuidv4();
      const hashedPassword = await bcrypt.hash('password123', 12);
      
      await pool.request()
        .input('id', sql.NVarChar, userId)
        .input('firstName', sql.NVarChar, 'Sudhen')
        .input('lastName', sql.NVarChar, 'Reddy')
        .input('email', sql.NVarChar, 'sudhenreddym@gmail.com')
        .input('password', sql.NVarChar, hashedPassword)
        .input('provider', sql.NVarChar, 'local')
        .input('role', sql.NVarChar, 'user')
        .query(`
          INSERT INTO Users (id, firstName, lastName, email, password, provider, role)
          VALUES (@id, @firstName, @lastName, @email, @password, @provider, @role)
        `);
      
      console.log(`✅ User created with ID: ${userId}`);
    }
    
    // Create default workspace if not exists
    const workspaceCheck = await pool.request()
      .input('ownerId', sql.NVarChar, userId)
      .query('SELECT id FROM Workspaces WHERE ownerId = @ownerId');
    
    let workspaceId;
    if (workspaceCheck.recordset.length > 0) {
      workspaceId = workspaceCheck.recordset[0].id;
      console.log(`✅ Workspace already exists with ID: ${workspaceId}`);
    } else {
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
      
      console.log(`✅ Workspace created with ID: ${workspaceId}`);
    }
    
    // Create chat if not exists
    const chatCheck = await pool.request()
      .input('userId', sql.NVarChar, userId)
      .query('SELECT id FROM Chats WHERE userId = @userId');
    
    let chatId;
    if (chatCheck.recordset.length > 0) {
      chatId = chatCheck.recordset[0].id;
      console.log(`✅ Chat already exists with ID: ${chatId}`);
    } else {
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
      
      console.log(`✅ Chat created with ID: ${chatId}`);
    }
    
    // Insert messages
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
      .input('content', sql.NVarChar, 'Hello Sudhen! This is a response from AIVA. How can I assist you today?')
      .input('role', sql.NVarChar, 'assistant')
      .query(`
        INSERT INTO Messages (id, chatId, userId, content, role, createdAt)
        VALUES (@id, @chatId, @userId, @content, @role, GETUTCDATE())
      `);
    
    console.log(`✅ AI message created with ID: ${messageId2}`);
    
    // Insert message actions (like, bookmark)
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
    console.log('User email: sudhenreddym@gmail.com');
    console.log('User password: password123');
    console.log('You should now be able to log in and see the mock data in the frontend.');
    
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

insertMockData();