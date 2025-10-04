import { DatabaseManager } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import sql from 'mssql';

async function createMoreWorkspaces() {
  try {
    console.log('🔄 Creating additional workspaces and assignments...');
    
    // Initialize database
    const dbManager = DatabaseManager.getInstance();
    const pool = await dbManager.getPool();
    
    // Get all users to assign workspaces to
    const usersResult = await pool.request()
      .query('SELECT id, email, firstName, lastName FROM Users WHERE role = \'user\'');
    
    console.log(`👥 Found ${usersResult.recordset.length} users:`);
    usersResult.recordset.forEach(user => {
      console.log(`  - ${user.email} (${user.id})`);
    });
    
    // Admin user ID
    const adminUserId = '7FC8F24A-5494-426C-93F2-61471A72D6AD';
    
    // Create additional workspaces
    const workspacesToCreate = [
      {
        name: 'Marketing Team',
        description: 'Marketing campaigns and content creation',
        color: '#10B981'
      },
      {
        name: 'Development Team',
        description: 'Software development and technical discussions',
        color: '#8B5CF6'
      },
      {
        name: 'Sales Department',
        description: 'Sales strategies and customer management',
        color: '#F59E0B'
      },
      {
        name: 'HR & Operations',
        description: 'Human resources and operational matters',
        color: '#EF4444'
      }
    ];
    
    const createdWorkspaces = [];
    
    for (const workspace of workspacesToCreate) {
      const workspaceId = uuidv4();
      
      console.log(`🏢 Creating workspace: ${workspace.name}`);
      
      // Create workspace
      await pool.request()
        .input('id', sql.NVarChar, workspaceId)
        .input('name', sql.NVarChar, workspace.name)
        .input('description', sql.NVarChar, workspace.description)
        .input('color', sql.NVarChar, workspace.color)
        .input('isShared', sql.Bit, true)
        .input('ownerId', sql.NVarChar, adminUserId)
        .query(`
          INSERT INTO Workspaces (id, name, description, color, isShared, ownerId)
          VALUES (@id, @name, @description, @color, @isShared, @ownerId)
        `);
      
      createdWorkspaces.push({ id: workspaceId, ...workspace });
      console.log(`✅ Created workspace: ${workspace.name} (${workspaceId})`);
    }
    
    // Assign users to workspaces
    console.log('🔗 Assigning users to workspaces...');
    
    for (const user of usersResult.recordset) {
      // Assign each user to 2-3 random workspaces
      const numAssignments = Math.floor(Math.random() * 2) + 2; // 2-3 workspaces
      const shuffledWorkspaces = [...createdWorkspaces].sort(() => Math.random() - 0.5);
      const workspacesToAssign = shuffledWorkspaces.slice(0, numAssignments);
      
      for (const workspace of workspacesToAssign) {
        const assignmentId = uuidv4();
        const accessLevel = Math.random() > 0.7 ? 'readonly' : 'member'; // 30% readonly, 70% member
        
        try {
          await pool.request()
            .input('id', sql.NVarChar, assignmentId)
            .input('workspaceId', sql.NVarChar, workspace.id)
            .input('userId', sql.NVarChar, user.id)
            .input('accessLevel', sql.NVarChar, accessLevel)
            .input('assignedBy', sql.NVarChar, adminUserId)
            .input('assignedAt', sql.DateTime, new Date())
            .query(`
              INSERT INTO WorkspaceUsers (id, workspaceId, userId, accessLevel, assignedBy, assignedAt)
              VALUES (@id, @workspaceId, @userId, @accessLevel, @assignedBy, @assignedAt)
            `);
          
          console.log(`  ✅ Assigned ${user.email} to ${workspace.name} (${accessLevel})`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          if (errorMessage.includes('duplicate key')) {
            console.log(`  ⚠️ ${user.email} already assigned to ${workspace.name}`);
          } else {
            console.error(`  ❌ Error assigning ${user.email} to ${workspace.name}:`, errorMessage);
          }
        }
      }
    }
    
    // Verify assignments
    console.log('\n🔍 Verifying workspace assignments...');
    for (const user of usersResult.recordset) {
      const result = await pool.request()
        .input('userId', sql.NVarChar, user.id)
        .query(`
          SELECT w.name, wu.accessLevel
          FROM Workspaces w
          INNER JOIN WorkspaceUsers wu ON w.id = wu.workspaceId
          WHERE wu.userId = @userId
          ORDER BY w.name
        `);
      
      console.log(`📋 ${user.email} has access to ${result.recordset.length} workspaces:`);
      result.recordset.forEach(ws => {
        console.log(`  - ${ws.name} (${ws.accessLevel})`);
      });
    }
    
    console.log('\n✅ Workspace creation and assignment completed!');
    
  } catch (error) {
    console.error('❌ Script failed:', error);
  } finally {
    process.exit(0);
  }
}

// Run the script
createMoreWorkspaces();
