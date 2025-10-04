import dotenv from 'dotenv';
import { DatabaseManager } from '../config/database';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import * as sql from 'mssql';

// Load environment variables
dotenv.config({ path: '.env' });

async function createWorkspaces() {
  try {
    logger.info('🚀 Starting workspace creation process...');
    
    const dbManager = DatabaseManager.getInstance();
    const pool = await dbManager.getPool();
    
    // Find the admin user to own the workspaces
    const adminResult = await pool.request()
      .input('email', sql.NVarChar, 'sudhenreddym@gmail.com')
      .query('SELECT id FROM Users WHERE email = @email AND role = \'admin\'');
    
    if (adminResult.recordset.length === 0) {
      throw new Error('Admin user not found');
    }
    
    const adminId = adminResult.recordset[0].id;
    logger.info(`✅ Found admin user: ${adminId}`);
    
    const workspaces = [
      {
        id: uuidv4(),
        name: 'Legal',
        description: 'Legal department workspace',
        color: '#3B82F6',
        isShared: true,
        ownerId: adminId
      },
      {
        id: uuidv4(),
        name: 'Marketing',
        description: 'Marketing team workspace',
        color: '#10B981',
        isShared: true,
        ownerId: adminId
      },
      {
        id: uuidv4(),
        name: 'Development',
        description: 'Development team workspace',
        color: '#F59E0B',
        isShared: false,
        ownerId: adminId
      }
    ];
    
    let createdCount = 0;
    let existingCount = 0;
    
    for (const workspace of workspaces) {
      try {
        // Check if workspace already exists
        const existingResult = await pool.request()
          .input('name', sql.NVarChar, workspace.name)
          .input('ownerId', sql.NVarChar, workspace.ownerId)
          .query('SELECT id FROM Workspaces WHERE name = @name AND ownerId = @ownerId');
        
        if (existingResult.recordset.length > 0) {
          logger.info(`ℹ️  Workspace already exists: ${workspace.name}`);
          existingCount++;
          continue;
        }
        
        // Create workspace
        await pool.request()
          .input('id', sql.NVarChar, workspace.id)
          .input('name', sql.NVarChar, workspace.name)
          .input('description', sql.NVarChar, workspace.description)
          .input('color', sql.NVarChar, workspace.color)
          .input('isShared', sql.Bit, workspace.isShared)
          .input('ownerId', sql.NVarChar, workspace.ownerId)
          .input('createdAt', sql.DateTime2, new Date())
          .input('updatedAt', sql.DateTime2, new Date())
          .query(`
            INSERT INTO Workspaces (id, name, description, color, isShared, ownerId, createdAt, updatedAt)
            VALUES (@id, @name, @description, @color, @isShared, @ownerId, @createdAt, @updatedAt)
          `);
        
        logger.info(`✅ Created workspace: ${workspace.name}`);
        createdCount++;
        
      } catch (error) {
        logger.error(`❌ Failed to create workspace ${workspace.name}:`, error);
      }
    }
    
    // Display all workspaces
    const allWorkspaces = await pool.request()
      .query('SELECT * FROM Workspaces ORDER BY createdAt DESC');
    
    logger.info('\n📊 Summary:');
    logger.info('============================================================');
    logger.info(`✅ Created: ${createdCount} workspaces`);
    logger.info(`ℹ️  Already existed: ${existingCount} workspaces`);
    
    if (allWorkspaces.recordset.length > 0) {
      logger.info('\n📋 All workspaces in database:');
      console.table(allWorkspaces.recordset.map(w => ({
        id: w.id,
        name: w.name,
        description: w.description,
        color: w.color,
        isShared: w.isShared,
        ownerId: w.ownerId,
        createdAt: w.createdAt
      })));
    }
    
    logger.info('\n✨ Workspace creation process completed!');
    logger.info('\n📝 Next steps:');
    logger.info('1. Workspaces are now available for user assignment');
    logger.info('2. Use the admin interface to assign users to workspaces');
    logger.info('3. Test the workspace assignment functionality');
    logger.info('\n🎯 Script execution completed successfully!');
    
  } catch (error) {
    logger.error('❌ Workspace creation failed:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

// Run the script
createWorkspaces();
