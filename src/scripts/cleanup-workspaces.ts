import { DatabaseManager } from '../config/database';
import sql from 'mssql';

async function cleanupWorkspaces() {
  try {
    console.log('🧹 Starting workspace cleanup...');
    
    // Initialize database
    const dbManager = DatabaseManager.getInstance();
    const pool = await dbManager.getPool();
    
    // Get count of existing workspaces
    const countResult = await pool.request()
      .query('SELECT COUNT(*) as total FROM Workspaces');
    
    const totalWorkspaces = countResult.recordset[0].total;
    console.log(`📊 Found ${totalWorkspaces} existing workspaces`);
    
    if (totalWorkspaces === 0) {
      console.log('✅ No workspaces to clean up');
      return;
    }
    
    // List all workspaces before deletion
    const workspacesResult = await pool.request()
      .query('SELECT id, name, ownerId, createdAt FROM Workspaces ORDER BY createdAt DESC');
    
    console.log('\n📋 Existing workspaces:');
    workspacesResult.recordset.forEach((ws, index) => {
      console.log(`  ${index + 1}. ${ws.name} (${ws.id}) - Owner: ${ws.ownerId}`);
    });
    
    // Delete all workspace user assignments first (foreign key constraint)
    console.log('\n🔗 Removing workspace user assignments...');
    const assignmentDeleteResult = await pool.request()
      .query('DELETE FROM WorkspaceUsers');
    
    console.log(`✅ Removed ${assignmentDeleteResult.rowsAffected[0]} workspace user assignments`);
    
    // Delete message actions for workspace messages first (foreign key constraint)
    console.log('⚡ Removing message actions...');
    const messageActionsResult = await pool.request()
      .query(`
        DELETE FROM MessageActions 
        WHERE messageId IN (
          SELECT m.id FROM Messages m
          INNER JOIN Chats c ON m.chatId = c.id
          WHERE c.workspaceId IS NOT NULL
        )
      `);
    
    console.log(`✅ Removed ${messageActionsResult.rowsAffected[0]} message actions`);
    
    // Delete all messages in workspace chats (foreign key constraint)
    console.log('📝 Removing workspace messages...');
    const messageDeleteResult = await pool.request()
      .query(`
        DELETE FROM Messages 
        WHERE chatId IN (
          SELECT id FROM Chats WHERE workspaceId IS NOT NULL
        )
      `);
    
    console.log(`✅ Removed ${messageDeleteResult.rowsAffected[0]} workspace messages`);
    
    // Delete all chats in workspaces (foreign key constraint)
    console.log('💬 Removing workspace chats...');
    const chatDeleteResult = await pool.request()
      .query('DELETE FROM Chats WHERE workspaceId IS NOT NULL');
    
    console.log(`✅ Removed ${chatDeleteResult.rowsAffected[0]} workspace chats`);
    
    // Delete workspace files (foreign key constraint)
    console.log('📁 Removing workspace files...');
    const filesDeleteResult = await pool.request()
      .query('DELETE FROM WorkspaceFiles');
    
    console.log(`✅ Removed ${filesDeleteResult.rowsAffected[0]} workspace files`);
    
    // Now delete all workspaces
    console.log('🏢 Removing all workspaces...');
    const workspaceDeleteResult = await pool.request()
      .query('DELETE FROM Workspaces');
    
    console.log(`✅ Removed ${workspaceDeleteResult.rowsAffected[0]} workspaces`);
    
    // Verify cleanup
    const finalCountResult = await pool.request()
      .query('SELECT COUNT(*) as total FROM Workspaces');
    
    const remainingWorkspaces = finalCountResult.recordset[0].total;
    
    if (remainingWorkspaces === 0) {
      console.log('\n🎉 Workspace cleanup completed successfully!');
      console.log('📝 Summary:');
      console.log(`   - Removed ${totalWorkspaces} workspaces`);
      console.log(`   - Removed ${assignmentDeleteResult.rowsAffected[0]} user assignments`);
      console.log(`   - Removed ${chatDeleteResult.rowsAffected[0]} chats`);
      console.log(`   - Removed ${messageDeleteResult.rowsAffected[0]} messages`);
      console.log('\n✨ Admin now has full control to create workspaces from scratch!');
    } else {
      console.log(`⚠️ Warning: ${remainingWorkspaces} workspaces still remain`);
    }
    
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error details:', errorMessage);
  } finally {
    process.exit(0);
  }
}

// Run the cleanup
cleanupWorkspaces();
