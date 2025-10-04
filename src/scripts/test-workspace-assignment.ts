import { DatabaseManager } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import sql from 'mssql';

async function testWorkspaceAssignment() {
  try {
    console.log('🔄 Starting workspace assignment test...');
    
    // Initialize database
    const dbManager = DatabaseManager.getInstance();
    const pool = await dbManager.getPool();
    
    // Find or create a test user
    let testUserId: string;
    let testUserEmail = 'testuser@example.com';
    
    console.log('👤 Looking for existing test user...');
    const existingUserResult = await pool.request()
      .input('email', sql.NVarChar, testUserEmail)
      .query('SELECT id, email FROM Users WHERE email = @email');
    
    if (existingUserResult.recordset.length > 0) {
      testUserId = existingUserResult.recordset[0].id;
      console.log(`✅ Found existing test user: ${testUserEmail} (${testUserId})`);
    } else {
      // Create a new test user
      testUserId = uuidv4();
      const hashedPassword = await bcrypt.hash('TestPassword123!', 12);
      
      console.log('👤 Creating new test user...');
      await pool.request()
        .input('id', sql.NVarChar, testUserId)
        .input('firstName', sql.NVarChar, 'Test')
        .input('lastName', sql.NVarChar, 'User')
        .input('email', sql.NVarChar, testUserEmail)
        .input('password', sql.NVarChar, hashedPassword)
        .input('provider', sql.NVarChar, 'local')
        .input('role', sql.NVarChar, 'user')
        .query(`
          INSERT INTO Users (id, firstName, lastName, email, password, provider, role)
          VALUES (@id, @firstName, @lastName, @email, @password, @provider, @role)
        `);
      
      console.log(`✅ Test user created: ${testUserEmail} (${testUserId})`);
    }
    
    // Create a test workspace
    const workspaceId = uuidv4();
    const adminUserId = '7FC8F24A-5494-426C-93F2-61471A72D6AD'; // Admin user ID
    
    console.log('🏢 Creating test workspace...');
    await pool.request()
      .input('id', sql.NVarChar, workspaceId)
      .input('name', sql.NVarChar, 'Test Workspace')
      .input('description', sql.NVarChar, 'A test workspace for assignment testing')
      .input('color', sql.NVarChar, '#3B82F6')
      .input('isShared', sql.Bit, true)
      .input('ownerId', sql.NVarChar, adminUserId)
      .query(`
        INSERT INTO Workspaces (id, name, description, color, isShared, ownerId)
        VALUES (@id, @name, @description, @color, @isShared, @ownerId)
      `);
    
    console.log(`✅ Test workspace created: Test Workspace (${workspaceId})`);
    
    // Assign user to workspace
    const assignmentId = uuidv4();
    
    console.log('🔗 Assigning user to workspace...');
    await pool.request()
      .input('id', sql.NVarChar, assignmentId)
      .input('workspaceId', sql.NVarChar, workspaceId)
      .input('userId', sql.NVarChar, testUserId)
      .input('accessLevel', sql.NVarChar, 'member')
      .input('assignedBy', sql.NVarChar, adminUserId)
      .input('assignedAt', sql.DateTime, new Date())
      .query(`
        INSERT INTO WorkspaceUsers (id, workspaceId, userId, accessLevel, assignedBy, assignedAt)
        VALUES (@id, @workspaceId, @userId, @accessLevel, @assignedBy, @assignedAt)
      `);
    
    console.log(`✅ User assigned to workspace with member access`);
    
    // Verify the assignment by querying workspaces for the user
    console.log('🔍 Verifying workspace assignment...');
    const result = await pool.request()
      .input('userId', sql.NVarChar, testUserId)
      .query(`
        SELECT 
          w.*,
          wu.accessLevel,
          (SELECT COUNT(*) FROM Chats WHERE workspaceId = w.id AND isArchived = 0) as chatCount,
          (SELECT MAX(lastMessageAt) FROM Chats WHERE workspaceId = w.id) as lastActivity
        FROM Workspaces w
        INNER JOIN WorkspaceUsers wu ON w.id = wu.workspaceId
        WHERE wu.userId = @userId
        ORDER BY w.updatedAt DESC
      `);
    
    console.log(`📋 Found ${result.recordset.length} workspaces for user:`);
    result.recordset.forEach(workspace => {
      console.log(`  - ${workspace.name} (${workspace.id}) - Access: ${workspace.accessLevel}`);
    });
    
    console.log('✅ Workspace assignment test completed successfully!');
    console.log(`\n📝 Test user credentials:`);
    console.log(`   Email: ${testUserEmail}`);
    console.log(`   Password: TestPassword123!`);
    console.log(`   User ID: ${testUserId}`);
    console.log(`\n🏢 Test workspace:`);
    console.log(`   Name: Test Workspace`);
    console.log(`   ID: ${workspaceId}`);
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    process.exit(0);
  }
}

// Run the test
testWorkspaceAssignment();
