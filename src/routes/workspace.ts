import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticateToken, requireAdmin } from '../middleware/auth';
import { validate, schemas } from '../middleware/validation';
import { DatabaseManager } from '../config/database';
import { logger } from '../utils/logger';
import sql from 'mssql';
import { blobServiceClient } from '../services/azure';
import { WorkspaceStorageService } from '../services/workspaceStorage';
import multer from 'multer';

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allow common file types
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'application/octet-stream' // For .env files and other unknown types
    ];
    
    // Also allow files with no MIME type specified
    if (allowedTypes.includes(file.mimetype) || !file.mimetype) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'));
    }
  }
});

// Apply authentication to all workspace routes
router.use(authenticateToken);

const dbManager = DatabaseManager.getInstance();

// Lightweight audit logging helper (DB-backed if table exists, otherwise no-op)
async function logWorkspaceAudit(pool: any, params: { userId: string; workspaceId: string; action: string; details?: string }) {
  try {
    await pool.request()
      .input('id', sql.NVarChar, uuidv4())
      .input('userId', sql.NVarChar, params.userId)
      .input('workspaceId', sql.NVarChar, params.workspaceId)
      .input('action', sql.NVarChar, params.action)
      .input('details', sql.NVarChar, params.details || '')
      .query(`
        INSERT INTO AuditLogs (id, userId, workspaceId, action, details, createdAt)
        VALUES (@id, @userId, @workspaceId, @action, @details, GETUTCDATE())
      `);
  } catch (e) {
    // Table may not exist; avoid breaking the request path
    logger.debug('Audit log write skipped or failed', { action: params.action, err: (e as Error)?.message });
  }
}

// Get user's workspaces (users see only assigned workspaces, admins see all they own)
router.get('/', async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;
    const { page, limit, sortBy, sortOrder, search } = req.query as any;
    
    logger.info(`Getting workspaces for user: ${userId} (${userRole})`);
    logger.info(`Query params: page=${page}, limit=${limit}, sortBy=${sortBy}, sortOrder=${sortOrder}`);
    
    const pool = await dbManager.getPool();
    const pageNum = page ? Number(page) : undefined;
    const limitNum = limit ? Number(limit) : undefined;
    const isPaginated = Number.isFinite(pageNum) && Number.isFinite(limitNum) && (pageNum as number) > 0 && (limitNum as number) > 0;

    // Sanitize sort inputs; default to consistent name ASC if not provided
    const allowedSortBy = new Set(['name', 'createdAt', 'updatedAt', 'lastActivity', 'chatCount']);
    const sortByKey = (typeof sortBy === 'string' && allowedSortBy.has(sortBy)) ? sortBy : 'name';
    const sortOrderKey = (typeof sortOrder === 'string' && sortOrder.toLowerCase() === 'desc') ? 'DESC' : 'ASC';
    
    let workspaceQuery = '';
    let countQuery = '';
    
    if (userRole === 'admin') {
      // Admins can see all workspaces they own
      workspaceQuery = `
        SELECT 
          w.*,
          COALESCE(chatStats.chatCount, 0) as chatCount,
          chatStats.lastActivity
        FROM Workspaces w
        LEFT JOIN (
          SELECT 
            workspaceId,
            COUNT(*) as chatCount,
            MAX(lastMessageAt) as lastActivity
          FROM Chats 
          WHERE isArchived = 0
          GROUP BY workspaceId
        ) chatStats ON w.id = chatStats.workspaceId
        WHERE w.ownerId = @userId
        ${search ? 'AND (w.name LIKE @search OR w.description LIKE @search)' : ''}
        ORDER BY ${sortByKey} ${sortOrderKey}
        ${isPaginated ? 'OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY' : ''}
      `;
      countQuery = `
        SELECT COUNT(*) as total 
        FROM Workspaces w
        WHERE w.ownerId = @userId
        ${search ? 'AND (w.name LIKE @search OR w.description LIKE @search)' : ''}
      `;
    } else {
      // Regular users: one row per assigned workspace. Use aggregated subquery to avoid duplicates.
      workspaceQuery = `
        SELECT 
          w.*,
          wuAgg.accessLevel,
          COALESCE(chatStats.chatCount, 0) as chatCount,
          chatStats.lastActivity
        FROM Workspaces w
        INNER JOIN (
          SELECT workspaceId, MAX(accessLevel) as accessLevel
          FROM WorkspaceUsers
          WHERE userId = @userId
          GROUP BY workspaceId
        ) wuAgg ON w.id = wuAgg.workspaceId
        LEFT JOIN (
          SELECT 
            workspaceId,
            COUNT(*) as chatCount,
            MAX(lastMessageAt) as lastActivity
          FROM Chats 
          WHERE isArchived = 0
          GROUP BY workspaceId
        ) chatStats ON w.id = chatStats.workspaceId
        WHERE 1=1
        ${search ? 'AND (w.name LIKE @search OR w.description LIKE @search)' : ''}
        ORDER BY ${sortByKey} ${sortOrderKey}
        ${isPaginated ? 'OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY' : ''}
      `;
      countQuery = `
        SELECT COUNT(*) as total 
        FROM (
          SELECT w.id
          FROM Workspaces w
          INNER JOIN (
            SELECT workspaceId
            FROM WorkspaceUsers
            WHERE userId = @userId
            GROUP BY workspaceId
          ) wuAgg ON w.id = wuAgg.workspaceId
          WHERE 1=1
          ${search ? 'AND (w.name LIKE @search OR w.description LIKE @search)' : ''}
        ) t
      `;
    }
    
    const reqMain = pool.request().input('userId', sql.NVarChar, userId);
    if (search) reqMain.input('search', sql.NVarChar, `%${search}%`);
    if (isPaginated) {
      reqMain.input('limit', sql.Int, limitNum as number).input('offset', sql.Int, ((pageNum as number) - 1) * (limitNum as number));
    }
    const result = await reqMain.query(workspaceQuery);

    // Optional: compute accurate total only when paginated; otherwise use full length
    let total = result.recordset.length;
    if (isPaginated) {
      const reqCount = pool.request().input('userId', sql.NVarChar, userId);
      if (search) reqCount.input('search', sql.NVarChar, `%${search}%`);
      const countResult = await reqCount.query(countQuery);
      total = countResult.recordset[0]?.total ?? total;
    }

    logger.info(`Found ${result.recordset.length} workspaces for user ${userId}`);
    logger.info(`Workspace names: ${result.recordset.map(w => w.name).join(', ')}`);

    // Integrity checks: log orphaned or duplicate assignments for debugging
    try {
      const orphan = await pool.request()
        .input('userId', sql.NVarChar, userId)
        .query(`
          SELECT wu.workspaceId
          FROM WorkspaceUsers wu
          LEFT JOIN Workspaces w ON wu.workspaceId = w.id
          WHERE wu.userId = @userId AND w.id IS NULL
        `);
      if (orphan.recordset.length > 0) {
        logger.warn('Orphaned workspace assignments detected', { userId, orphanedIds: orphan.recordset.map((r: any) => r.workspaceId) });
      }
      const dups = await pool.request()
        .input('userId', sql.NVarChar, userId)
        .query(`
          SELECT workspaceId, COUNT(*) as cnt
          FROM WorkspaceUsers
          WHERE userId = @userId
          GROUP BY workspaceId
          HAVING COUNT(*) > 1
        `);
      if (dups.recordset.length > 0) {
        logger.warn('Duplicate workspace assignments found', { userId, duplicates: dups.recordset });
      }
    } catch (intErr) {
      logger.error('Workspace assignment integrity check failed', intErr);
    }

    res.json({
      message: 'Workspaces retrieved successfully',
      workspaces: result.recordset,
      order: { sortBy: sortByKey, sortOrder: sortOrderKey },
      pagination: isPaginated ? {
        page: pageNum,
        limit: limitNum,
        total,
        pages: limitNum ? Math.ceil(total / (limitNum as number)) : 1
      } : undefined
    });
  } catch (error) {
    logger.error('Get workspaces error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    logger.error('Error details:', {
      message: errorMessage,
      stack: errorStack,
      userId: req.user?.userId,
      userRole: req.user?.role
    });
    res.status(500).json({
      error: 'Failed to retrieve workspaces',
      details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
  }
});

// Create new workspace (admin only)
router.post('/', requireAdmin, validate(schemas.createWorkspace), async (req, res) => {
  try {
    const { name, description, color, isShared } = req.body;
    const userId = req.user.userId;
    const workspaceId = uuidv4();
    
    const pool = await dbManager.getPool();
    
    const result = await pool.request()
      .input('id', sql.NVarChar, workspaceId)
      .input('name', sql.NVarChar, name)
      .input('description', sql.NVarChar, description || '')
      .input('color', sql.NVarChar, color || '#3B82F6')
      .input('isShared', sql.Bit, isShared || false)
      .input('ownerId', sql.NVarChar, userId)
      .query(`
        INSERT INTO Workspaces (id, name, description, color, isShared, ownerId, createdAt, updatedAt)
        OUTPUT INSERTED.*
        VALUES (@id, @name, @description, @color, @isShared, @ownerId, GETUTCDATE(), GETUTCDATE())
      `);
    
    // Also assign the owner to their own workspace
    const assignmentId = uuidv4();
    await pool.request()
      .input('id', sql.NVarChar, assignmentId)
      .input('workspaceId', sql.NVarChar, workspaceId)
      .input('userId', sql.NVarChar, userId)
      .input('accessLevel', sql.NVarChar, 'owner')
      .input('assignedBy', sql.NVarChar, userId)
      .query(`
        INSERT INTO WorkspaceUsers (id, workspaceId, userId, accessLevel, assignedBy, assignedAt)
        VALUES (@id, @workspaceId, @userId, @accessLevel, @assignedBy, GETUTCDATE())
      `);
    
    const workspace = result.recordset[0];
    
    // Create Azure Blob Storage container for the workspace
    const workspaceStorageService = WorkspaceStorageService.getInstance();
    const containerName = await workspaceStorageService.createWorkspaceContainer(workspaceId, name);
    
    if (containerName) {
      logger.info(`Azure Blob Storage container created and verified for workspace: ${containerName}`);
      // Add container info to workspace object
      workspace.containerName = containerName;
    } else {
      logger.warn(`Failed to create Azure Blob Storage container for workspace: ${name}`);
    }

    res.status(201).json({
      message: 'Workspace created successfully',
      workspace
    });

    logger.info(`Workspace created: ${workspaceId} by user: ${userId}`);

    // Audit log
    try {
      await logWorkspaceAudit(pool, { userId, workspaceId, action: 'workspace.create', details: name });
    } catch {}
  } catch (error) {
    logger.error('Create workspace error:', error);
    res.status(500).json({
      error: 'Failed to create workspace'
    });
  }
});

// Update workspace (admin only)
router.put('/:id', requireAdmin, validate(schemas.uuidParam), validate(schemas.updateWorkspace), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, color, isShared } = req.body;
    const userId = req.user.userId;
    
    const pool = await dbManager.getPool();
    
    // Verify workspace belongs to user
    const workspaceCheck = await pool.request()
      .input('id', sql.NVarChar, id)
      .input('userId', sql.NVarChar, userId)
      .query('SELECT id FROM Workspaces WHERE id = @id AND ownerId = @userId');
    
    if (workspaceCheck.recordset.length === 0) {
      return res.status(404).json({
        error: 'Workspace not found',
        message: 'Workspace not found'
      });
    }
    
    const result = await pool.request()
      .input('id', sql.NVarChar, id)
      .input('name', sql.NVarChar, name)
      .input('description', sql.NVarChar, description)
      .input('color', sql.NVarChar, color)
      .input('isShared', sql.Bit, isShared)
      .query(`
        UPDATE Workspaces 
        SET 
          name = COALESCE(@name, name),
          description = COALESCE(@description, description),
          color = COALESCE(@color, color),
          isShared = COALESCE(@isShared, isShared),
          updatedAt = GETUTCDATE()
        OUTPUT INSERTED.*
        WHERE id = @id
      `);
    
    const workspace = result.recordset[0];

    res.json({
      message: 'Workspace updated successfully',
      workspace
    });

    logger.info(`Workspace updated: ${id} by user: ${userId}`);
  } catch (error) {
    logger.error('Update workspace error:', error);
    res.status(500).json({
      error: 'Failed to update workspace'
    });
  }
});

// Delete workspace (admin only)
router.delete('/:id', requireAdmin, validate(schemas.uuidParam), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    
    const pool = await dbManager.getPool();
    
    // Verify workspace belongs to user and get workspace details
    const workspaceCheck = await pool.request()
      .input('id', sql.NVarChar, id)
      .input('userId', sql.NVarChar, userId)
      .query('SELECT id, name FROM Workspaces WHERE id = @id AND ownerId = @userId');
    
    if (workspaceCheck.recordset.length === 0) {
      return res.status(404).json({
        error: 'Workspace not found',
        message: 'Workspace not found or access denied'
      });
    }
    
    const workspace = workspaceCheck.recordset[0];
    const workspaceName = workspace.name;
    
    // Check if workspace has any chats (archived or active)
    const chatCheck = await pool.request()
      .input('workspaceId', sql.NVarChar, id)
      .query('SELECT COUNT(*) as count FROM Chats WHERE workspaceId = @workspaceId');
    
    const chatCount = chatCheck.recordset[0].count;
    
    if (chatCount > 0) {
      // Archive all chats in the workspace before deletion
      await pool.request()
        .input('workspaceId', sql.NVarChar, id)
        .query('UPDATE Chats SET isArchived = 1, workspaceId = NULL WHERE workspaceId = @workspaceId');
    }
    
    // Delete all workspace files first (to avoid foreign key constraint issues)
    await pool.request()
      .input('workspaceId', sql.NVarChar, id)
      .query('DELETE FROM WorkspaceFiles WHERE workspaceId = @workspaceId');
    
    // Delete all workspace users
    await pool.request()
      .input('workspaceId', sql.NVarChar, id)
      .query('DELETE FROM WorkspaceUsers WHERE workspaceId = @workspaceId');
    
    // Delete workspace
    await pool.request()
      .input('id', sql.NVarChar, id)
      .query('DELETE FROM Workspaces WHERE id = @id');
    
    // Delete Azure Blob Storage container for the workspace
    const workspaceStorageService = WorkspaceStorageService.getInstance();
    const containerDeleted = await workspaceStorageService.deleteWorkspaceContainer(id, workspaceName);
    
    if (containerDeleted) {
      logger.info(`Azure Blob Storage container deleted for workspace: ${id}`);
    } else {
      logger.warn(`Failed to delete Azure Blob Storage container for workspace: ${id}`);
    }

    res.json({
      message: 'Workspace deleted successfully',
      workspaceId: id
    });

    logger.info(`Workspace deleted: ${id} by user: ${userId}`);
  } catch (error) {
    logger.error('Delete workspace error:', error);
    res.status(500).json({
      error: 'Failed to delete workspace'
    });
  }
});

// Get workspace details with chats
router.get('/:id', validate(schemas.uuidParam), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const userRole = req.user.role;
    
    logger.info(`Getting workspace details for workspace ${id}, user ${userId} (${userRole})`);
    
    const pool = await dbManager.getPool();
    
    // Check if user has access to this workspace
    let accessQuery = '';
    if (userRole === 'admin') {
      // Admin can access workspaces they own
      accessQuery = `
        SELECT 
          w.*,
          'owner' as accessLevel,
          (SELECT COUNT(*) FROM Chats WHERE workspaceId = w.id AND isArchived = 0) as chatCount
        FROM Workspaces w
        WHERE w.id = @id AND w.ownerId = @userId
      `;
    } else {
      // Regular users can only access assigned workspaces
      accessQuery = `
        SELECT 
          w.*,
          wu.accessLevel,
          (SELECT COUNT(*) FROM Chats WHERE workspaceId = w.id AND isArchived = 0) as chatCount
        FROM Workspaces w
        INNER JOIN WorkspaceUsers wu ON w.id = wu.workspaceId
        WHERE w.id = @id AND wu.userId = @userId
      `;
    }
    
    const workspaceResult = await pool.request()
      .input('id', sql.NVarChar, id)
      .input('userId', sql.NVarChar, userId)
      .query(accessQuery);
    
    if (workspaceResult.recordset.length === 0) {
      return res.status(404).json({
        error: 'Workspace not found',
        message: 'Workspace not found or access denied'
      });
    }
    
    const workspace = workspaceResult.recordset[0];
    
    // Get recent chats in workspace
    const chatsResult = await pool.request()
      .input('workspaceId', sql.NVarChar, id)
      .query(`
        SELECT TOP 10
          c.*,
          (SELECT COUNT(*) FROM Messages WHERE chatId = c.id) as messageCount
        FROM Chats c
        WHERE c.workspaceId = @workspaceId AND c.isArchived = 0
        ORDER BY c.updatedAt DESC
      `);

    // Get workspace members
    let membersResult;
    try {
      logger.info(`Querying members for workspace ${id}`);
      membersResult = await pool.request()
        .input('workspaceId', sql.NVarChar, id)
        .query(`
          SELECT 
            u.id,
            u.firstName,
            u.lastName,
            u.email,
            u.avatar,
            wu.accessLevel,
            wu.assignedAt
          FROM Users u
          INNER JOIN WorkspaceUsers wu ON u.id = wu.userId
          WHERE wu.workspaceId = @workspaceId
          ORDER BY u.firstName, u.lastName
        `);

      logger.info(`Found ${membersResult.recordset.length} members for workspace ${id}`);
      if (membersResult.recordset.length > 0) {
        logger.info(`Members: ${membersResult.recordset.map(m => `${m.firstName} ${m.lastName} (${m.email})`).join(', ')}`);
      }
    } catch (memberError) {
      logger.error('Error fetching workspace members:', memberError);
      membersResult = { recordset: [] };
    }

    res.json({
      message: 'Workspace details retrieved successfully',
      workspace: {
        ...workspace,
        recentChats: chatsResult.recordset,
        members: membersResult.recordset
      }
    });
  } catch (error) {
    logger.error('Get workspace details error:', error);
    res.status(500).json({
      error: 'Failed to retrieve workspace details'
    });
  }
});

// Admin endpoints for user-workspace management

// Get all users for workspace assignment (admin only)
router.get('/:id/available-users', requireAdmin, validate(schemas.uuidParam), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const { search = '' } = req.query;
    
    const pool = await dbManager.getPool();
    
    // Verify workspace belongs to admin
    const workspaceCheck = await pool.request()
      .input('id', sql.NVarChar, id)
      .input('userId', sql.NVarChar, userId)
      .query('SELECT id FROM Workspaces WHERE id = @id AND ownerId = @userId');
    
    if (workspaceCheck.recordset.length === 0) {
      return res.status(404).json({
        error: 'Workspace not found',
        message: 'Workspace not found or access denied'
      });
    }
    
    let whereClause = "WHERE u.role != 'admin'";
    let searchInput = '';
    
    if (search) {
      whereClause += ` AND (u.firstName LIKE @search OR u.lastName LIKE @search OR u.email LIKE @search)`;
      searchInput = `%${search}%`;
    }
    
    const result = await pool.request()
      .input('workspaceId', sql.NVarChar, id)
      .input('search', sql.NVarChar, searchInput)
      .query(`
        SELECT 
          u.id,
          u.firstName,
          u.lastName,
          u.email,
          u.isActive,
          wu.accessLevel,
          wu.assignedAt,
          CASE WHEN wu.userId IS NOT NULL THEN 1 ELSE 0 END as isAssigned
        FROM Users u
        LEFT JOIN WorkspaceUsers wu ON u.id = wu.userId AND wu.workspaceId = @workspaceId
        ${whereClause}
        ORDER BY u.firstName, u.lastName
      `);

    res.json({
      message: 'Users retrieved successfully',
      users: result.recordset
    });
  } catch (error) {
    logger.error('Get available users error:', error);
    res.status(500).json({
      error: 'Failed to retrieve users'
    });
  }
});

// Assign user to workspace (admin only)
router.post('/:id/assign-user', requireAdmin, validate(schemas.uuidParam), validate(schemas.assignUsersToWorkspace), async (req, res) => {
  try {
    const { id } = req.params;
    const { userIds, accessLevel = 'member' } = req.body;
    const adminId = req.user.userId;
    
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        error: 'User IDs are required',
        message: 'Please provide an array of user IDs to assign'
      });
    }
    
    const pool = await dbManager.getPool();
    
    // Verify workspace belongs to admin
    const workspaceCheck = await pool.request()
      .input('id', sql.NVarChar, id)
      .input('adminId', sql.NVarChar, adminId)
      .query('SELECT id FROM Workspaces WHERE id = @id AND ownerId = @adminId');
    
    if (workspaceCheck.recordset.length === 0) {
      return res.status(404).json({
        error: 'Workspace not found',
        message: 'Workspace not found or access denied'
      });
    }
    
    const assignments = [];
    for (const userId of userIds) {
      const assignmentId = uuidv4();
      
      // Check if user is already assigned
      const existingAssignment = await pool.request()
        .input('workspaceId', sql.NVarChar, id)
        .input('userId', sql.NVarChar, userId)
        .query('SELECT id FROM WorkspaceUsers WHERE workspaceId = @workspaceId AND userId = @userId');
      
      if (existingAssignment.recordset.length === 0) {
        await pool.request()
          .input('id', sql.NVarChar, assignmentId)
          .input('workspaceId', sql.NVarChar, id)
          .input('userId', sql.NVarChar, userId)
          .input('accessLevel', sql.NVarChar, accessLevel)
          .input('assignedBy', sql.NVarChar, adminId)
          .query(`
            INSERT INTO WorkspaceUsers (id, workspaceId, userId, accessLevel, assignedBy)
            VALUES (@id, @workspaceId, @userId, @accessLevel, @assignedBy)
          `);
        
        assignments.push({ userId, assignmentId, status: 'assigned' });
      } else {
        assignments.push({ userId, status: 'already_assigned' });
      }
    }

    res.json({
      message: 'User assignments completed',
      assignments
    });

    logger.info(`Users assigned to workspace ${id} by admin ${adminId}:`, assignments);
  } catch (error) {
    logger.error('Assign user to workspace error:', error);
    res.status(500).json({
      error: 'Failed to assign users to workspace'
    });
  }
});

// Remove user from workspace (admin only)
router.post('/:id/remove-user', requireAdmin, validate(schemas.uuidParam), validate(schemas.removeUsersFromWorkspace), async (req, res) => {
  try {
    const { id } = req.params;
    const { userIds } = req.body;
    const adminId = req.user.userId;
    
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        error: 'User IDs are required',
        message: 'Please provide an array of user IDs to remove'
      });
    }
    
    const pool = await dbManager.getPool();
    
    // Verify workspace belongs to admin
    const workspaceCheck = await pool.request()
      .input('id', sql.NVarChar, id)
      .input('adminId', sql.NVarChar, adminId)
      .query('SELECT id FROM Workspaces WHERE id = @id AND ownerId = @adminId');
    
    if (workspaceCheck.recordset.length === 0) {
      return res.status(404).json({
        error: 'Workspace not found',
        message: 'Workspace not found or access denied'
      });
    }
    
    const removals = [];
    for (const userId of userIds) {
      const result = await pool.request()
        .input('workspaceId', sql.NVarChar, id)
        .input('userId', sql.NVarChar, userId)
        .query('DELETE FROM WorkspaceUsers WHERE workspaceId = @workspaceId AND userId = @userId');
      
      if (result.rowsAffected[0] > 0) {
        removals.push({ userId, status: 'removed' });
      } else {
        removals.push({ userId, status: 'not_found' });
      }
    }

    res.json({
      message: 'User removals completed',
      removals
    });

    logger.info(`Users removed from workspace ${id} by admin ${adminId}:`, removals);
  } catch (error) {
    logger.error('Remove user from workspace error:', error);
    res.status(500).json({
      error: 'Failed to remove users from workspace'
    });
  }
});

// Update user access level in workspace (admin only)
router.put('/:id/user-access', requireAdmin, validate(schemas.uuidParam), validate(schemas.updateUserAccess), async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, accessLevel } = req.body;
    const adminId = req.user.userId;
    
    if (!userId || !accessLevel) {
      return res.status(400).json({
        error: 'User ID and access level are required'
      });
    }
    
    const validAccessLevels = ['member', 'readonly'];
    if (!validAccessLevels.includes(accessLevel)) {
      return res.status(400).json({
        error: 'Invalid access level',
        message: 'Access level must be one of: member, readonly'
      });
    }
    
    const pool = await dbManager.getPool();
    
    // Verify workspace belongs to admin
    const workspaceCheck = await pool.request()
      .input('id', sql.NVarChar, id)
      .input('adminId', sql.NVarChar, adminId)
      .query('SELECT id FROM Workspaces WHERE id = @id AND ownerId = @adminId');
    
    if (workspaceCheck.recordset.length === 0) {
      return res.status(404).json({
        error: 'Workspace not found',
        message: 'Workspace not found or access denied'
      });
    }
    
    const result = await pool.request()
      .input('workspaceId', sql.NVarChar, id)
      .input('userId', sql.NVarChar, userId)
      .input('accessLevel', sql.NVarChar, accessLevel)
      .query(`
        UPDATE WorkspaceUsers 
        SET accessLevel = @accessLevel 
        WHERE workspaceId = @workspaceId AND userId = @userId
      `);
    
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({
        error: 'User assignment not found',
        message: 'User is not assigned to this workspace'
      });
    }

    res.json({
      message: 'User access level updated successfully',
      userId,
      accessLevel
    });

    logger.info(`User ${userId} access level updated to ${accessLevel} in workspace ${id} by admin ${adminId}`);
  } catch (error) {
    logger.error('Update user access level error:', error);
    res.status(500).json({
      error: 'Failed to update user access level'
    });
  }
});

// Get available users for workspace assignment (admin only)
router.get('/:id/available-users', requireAdmin, validate(schemas.uuidParam), async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await dbManager.getPool();
    
    // Verify workspace exists
    const workspaceCheck = await pool.request()
      .input('id', sql.NVarChar, id)
      .query('SELECT id, name FROM Workspaces WHERE id = @id');
    
    if (workspaceCheck.recordset.length === 0) {
      return res.status(404).json({
        error: 'Workspace not found'
      });
    }
    
    // Get all users with their assignment status for this workspace
    const users = await pool.request()
      .input('workspaceId', sql.NVarChar, id)
      .query(`
        SELECT 
          u.id,
          u.firstName,
          u.lastName,
          u.email,
          u.provider,
          u.isActive,
          u.role,
          wu.accessLevel,
          CASE WHEN wu.userId IS NOT NULL THEN 1 ELSE 0 END as isAssigned
        FROM Users u
        LEFT JOIN WorkspaceUsers wu ON u.id = wu.userId AND wu.workspaceId = @workspaceId
        WHERE u.isActive = 1
        ORDER BY u.firstName, u.lastName
      `);
    
    res.json({
      message: 'Available users retrieved successfully',
      users: users.recordset
    });
    
  } catch (error) {
    logger.error('Get available users error:', error);
    res.status(500).json({
      error: 'Failed to get available users'
    });
  }
});

// Assign users to workspace (admin only)
router.post('/:id/assign-users', requireAdmin, validate(schemas.uuidParam), async (req, res) => {
  try {
    const { id } = req.params;
    const { userIds, accessLevel = 'member' } = req.body;
    
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'userIds array is required'
      });
    }
    
    const pool = await dbManager.getPool();
    
    // Verify workspace exists
    const workspaceCheck = await pool.request()
      .input('id', sql.NVarChar, id)
      .query('SELECT id, name FROM Workspaces WHERE id = @id');
    
    if (workspaceCheck.recordset.length === 0) {
      return res.status(404).json({
        error: 'Workspace not found'
      });
    }
    
    const workspace = workspaceCheck.recordset[0];
    const results = {
      assigned: [] as Array<{ userId: string; email: string; accessLevel: string }>,
      updated: [] as Array<{ userId: string; email: string; accessLevel: string }>,
      failed: [] as Array<{ userId: string; reason: string }>
    };
    
    // Process each user assignment
    for (const userId of userIds) {
      try {
        // Check if user exists
        const userCheck = await pool.request()
          .input('userId', sql.NVarChar, userId)
          .query('SELECT id, email FROM Users WHERE id = @userId');
        
        if (userCheck.recordset.length === 0) {
          results.failed.push({ userId, reason: 'User not found' });
          continue;
        }
        
        const user = userCheck.recordset[0];
        
        // Check if assignment already exists
        const existingAssignment = await pool.request()
          .input('workspaceId', sql.NVarChar, id)
          .input('userId', sql.NVarChar, userId)
          .query('SELECT id, accessLevel FROM WorkspaceUsers WHERE workspaceId = @workspaceId AND userId = @userId');
        
        if (existingAssignment.recordset.length > 0) {
          // Update existing assignment
          await pool.request()
            .input('workspaceId', sql.NVarChar, id)
            .input('userId', sql.NVarChar, userId)
            .input('accessLevel', sql.NVarChar, accessLevel)
            .query('UPDATE WorkspaceUsers SET accessLevel = @accessLevel WHERE workspaceId = @workspaceId AND userId = @userId');
          
          results.updated.push({ userId, email: user.email, accessLevel });
        } else {
          // Create new assignment
          const assignmentId = uuidv4();
          const adminId = req.user.userId;
          await pool.request()
            .input('id', sql.NVarChar, assignmentId)
            .input('workspaceId', sql.NVarChar, id)
            .input('userId', sql.NVarChar, userId)
            .input('accessLevel', sql.NVarChar, accessLevel)
            .input('assignedBy', sql.NVarChar, adminId)
            .input('assignedAt', sql.DateTime, new Date())
            .query(`
              INSERT INTO WorkspaceUsers (id, workspaceId, userId, accessLevel, assignedBy, assignedAt)
              VALUES (@id, @workspaceId, @userId, @accessLevel, @assignedBy, @assignedAt)
            `);
          
          results.assigned.push({ userId, email: user.email, accessLevel });
        }
        
        logger.info(`User ${user.email} assigned to workspace ${workspace.name} with ${accessLevel} access`);
        
      } catch (error) {
        logger.error(`Failed to assign user ${userId}:`, error);
        console.error('Full error details:', error);
        results.failed.push({ userId, reason: `Database error: ${(error as Error).message}` });
      }
    }
    
    res.json({
      message: 'User assignment completed',
      workspace: workspace.name,
      results
    });
    
  } catch (error) {
    logger.error('Assign users error:', error);
    res.status(500).json({
      error: 'Failed to assign users'
    });
  }
});

// Remove users from workspace (admin only)
router.post('/:id/remove-users', requireAdmin, validate(schemas.uuidParam), async (req, res) => {
  try {
    const { id } = req.params;
    const { userIds } = req.body;
    
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'userIds array is required'
      });
    }
    
    const pool = await dbManager.getPool();
    
    // Verify workspace exists
    const workspaceCheck = await pool.request()
      .input('id', sql.NVarChar, id)
      .query('SELECT id, name FROM Workspaces WHERE id = @id');
    
    if (workspaceCheck.recordset.length === 0) {
      return res.status(404).json({
        error: 'Workspace not found'
      });
    }
    
    const workspace = workspaceCheck.recordset[0];
    const results = {
      removed: [] as Array<{ userId: string; email: string }>,
      failed: [] as Array<{ userId: string; reason: string }>
    };
    
    // Process each user removal
    for (const userId of userIds) {
      try {
        // Get user info before removal
        const userCheck = await pool.request()
          .input('userId', sql.NVarChar, userId)
          .query('SELECT email FROM Users WHERE id = @userId');
        
        if (userCheck.recordset.length === 0) {
          results.failed.push({ userId, reason: 'User not found' });
          continue;
        }
        
        const userEmail = userCheck.recordset[0].email;
        
        // Remove assignment
        const deleteResult = await pool.request()
          .input('workspaceId', sql.NVarChar, id)
          .input('userId', sql.NVarChar, userId)
          .query('DELETE FROM WorkspaceUsers WHERE workspaceId = @workspaceId AND userId = @userId');
        
        if (deleteResult.rowsAffected[0] > 0) {
          results.removed.push({ userId, email: userEmail });
          logger.info(`User ${userEmail} removed from workspace ${workspace.name}`);
        } else {
          results.failed.push({ userId, reason: 'Assignment not found' });
        }
        
      } catch (error) {
        logger.error(`Failed to remove user ${userId}:`, error);
        results.failed.push({ userId, reason: 'Database error' });
      }
    }
    
    res.json({
      message: 'User removal completed',
      workspace: workspace.name,
      results
    });
    
  } catch (error) {
    logger.error('Remove users error:', error);
    res.status(500).json({
      error: 'Failed to remove users'
    });
  }
});

// Upload file to workspace
router.post('/:id/upload', validate(schemas.uuidParam), upload.single('file'), async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const userRole = req.user.role;
    
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({
        error: 'No file provided',
        message: 'Please select a file to upload'
      });
    }
    
    const file = req.file;
    const fileId = uuidv4();
    
    const pool = await dbManager.getPool();
    
    // Check if user has access to this workspace
    let accessQuery = '';
    if (userRole === 'admin') {
      // Admin can upload files to workspaces they own
      accessQuery = `
        SELECT id, name FROM Workspaces 
        WHERE id = @id AND ownerId = @userId
      `;
    } else {
      // Regular users can upload files to workspaces they're assigned to with member access
      accessQuery = `
        SELECT w.id, w.name 
        FROM Workspaces w
        INNER JOIN WorkspaceUsers wu ON w.id = wu.workspaceId
        WHERE w.id = @id AND wu.userId = @userId AND wu.accessLevel = 'member'
      `;
    }
    
    // Verify workspace exists and user has access
    const workspaceCheck = await pool.request()
      .input('id', sql.NVarChar, id)
      .input('userId', sql.NVarChar, userId)
      .query(accessQuery);
    
    if (workspaceCheck.recordset.length === 0) {
      return res.status(404).json({
        error: 'Workspace not found',
        message: 'Workspace not found or access denied'
      });
    }
    
    const workspace = workspaceCheck.recordset[0];
    const workspaceName = workspace.name;
    
    // Upload file to workspace-specific blob container
    let fileUrl = '';
    const isMockStorage = !process.env.AZURE_STORAGE_ACCOUNT_NAME || process.env.MOCK_STORAGE === 'true';
    
    if (!isMockStorage && blobServiceClient) {
      // Use workspace-specific container with new naming format (max 63 chars)
      const sanitizedWorkspaceName = workspaceName.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
      const shortWorkspaceName = sanitizedWorkspaceName.substring(0, 20);
      const shortWorkspaceId = id.substring(0, 8);
      const containerName = `ws-${shortWorkspaceName}-${shortWorkspaceId}`;
      const containerClient = blobServiceClient.getContainerClient(containerName);
      
      // Ensure container exists
      await containerClient.createIfNotExists();
      
      const blobName = `${fileId}-${file.originalname}`;
      const blockBlobClient = containerClient.getBlockBlobClient(blobName);
      
      // Upload file to Azure Blob Storage
      await blockBlobClient.uploadData(file.buffer, {
        blobHTTPHeaders: {
          blobContentType: file.mimetype
        },
        metadata: {
          userId,
          workspaceId: id,
          originalName: file.originalname,
          uploadDate: new Date().toISOString()
        }
      });
      
      fileUrl = blockBlobClient.url;
    } else {
      // For mock storage, generate a mock URL
      const sanitizedWorkspaceName = workspaceName.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
      const shortWorkspaceName = sanitizedWorkspaceName.substring(0, 20);
      const shortWorkspaceId = id.substring(0, 8);
      fileUrl = `https://mockstorage.example.com/ws-${shortWorkspaceName}-${shortWorkspaceId}/${fileId}-${file.originalname}`;
    }
    
    // Store file metadata in database
    const fileData = {
      id: fileId,
      originalName: file.originalname,
      fileName: `${fileId}-${file.originalname}`,
      mimeType: file.mimetype,
      size: file.size,
      url: fileUrl,
      userId: userId,
      workspaceId: id
    };
    
    const insertResult = await pool.request()
      .input('id', sql.NVarChar, fileData.id)
      .input('originalName', sql.NVarChar, fileData.originalName)
      .input('fileName', sql.NVarChar, fileData.fileName)
      .input('mimeType', sql.NVarChar, fileData.mimeType)
      .input('size', sql.BigInt, fileData.size)
      .input('url', sql.NVarChar, fileData.url)
      .input('userId', sql.NVarChar, fileData.userId)
      .input('workspaceId', sql.NVarChar, fileData.workspaceId)
      .query(`
        INSERT INTO WorkspaceFiles (id, originalName, fileName, mimeType, size, url, userId, workspaceId, createdAt, updatedAt)
        OUTPUT INSERTED.*
        VALUES (@id, @originalName, @fileName, @mimeType, @size, @url, @userId, @workspaceId, GETUTCDATE(), GETUTCDATE())
      `);
    
    const uploadedFile = insertResult.recordset[0];
    
    res.json({
      message: 'File uploaded successfully',
      file: uploadedFile
    });
    
    logger.info(`File uploaded to workspace ${id}: ${file.originalname} by user: ${userId}`);

    // Audit log
    try {
      await logWorkspaceAudit(pool, { userId, workspaceId: id, action: 'workspace.file.upload', details: file.originalname });
    } catch {}
  } catch (error) {
      logger.error('Workspace file upload error:', error);
      res.status(500).json({
        error: 'Failed to upload file',
        message: 'Please try again later'
      });
  }
});

// Get files for workspace
router.get('/:id/files', validate(schemas.uuidParam), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const userRole = req.user.role;
    
    const pool = await dbManager.getPool();
    
    // Check if user has access to this workspace
    let accessQuery = '';
    if (userRole === 'admin') {
      // Admin can access files in workspaces they own
      accessQuery = `
        SELECT id FROM Workspaces 
        WHERE id = @id AND ownerId = @userId
      `;
    } else {
      // Regular users can access files in workspaces they're assigned to
      accessQuery = `
        SELECT w.id 
        FROM Workspaces w
        INNER JOIN WorkspaceUsers wu ON w.id = wu.workspaceId
        WHERE w.id = @id AND wu.userId = @userId
      `;
    }
    
    // Verify workspace exists and user has access
    const workspaceCheck = await pool.request()
      .input('id', sql.NVarChar, id)
      .input('userId', sql.NVarChar, userId)
      .query(accessQuery);
    
    if (workspaceCheck.recordset.length === 0) {
      return res.status(404).json({
        error: 'Workspace not found',
        message: 'Workspace not found or access denied'
      });
    }
    
    // Get files for this workspace
    const result = await pool.request()
      .input('workspaceId', sql.NVarChar, id)
      .query('SELECT * FROM WorkspaceFiles WHERE workspaceId = @workspaceId ORDER BY createdAt DESC');
    
    // Audit log (file list retrieval)
    try {
      await logWorkspaceAudit(pool, { userId, workspaceId: id, action: 'workspace.file.list' });
    } catch {}

    res.json({
      message: 'Workspace files retrieved successfully',
      files: result.recordset
    });
  } catch (error) {
    logger.error('Get workspace files error:', error);
    res.status(500).json({
      error: 'Failed to retrieve workspace files',
      message: 'Please try again later'
    });
  }
});

// Delete file from workspace
router.delete('/:id/files/:fileId', validate(schemas.uuidParam), async (req, res) => {
  try {
    const { id, fileId } = req.params;
    const userId = req.user.userId;
    const userRole = req.user.role;
    
    const pool = await dbManager.getPool();
    
    // Check if user has access to this workspace
    let accessQuery = '';
    if (userRole === 'admin') {
      // Admin can delete files in workspaces they own
      accessQuery = `
        SELECT id FROM Workspaces 
        WHERE id = @id AND ownerId = @userId
      `;
    } else {
      // Regular users can only delete files in workspaces they're assigned to with member access
      accessQuery = `
        SELECT w.id 
        FROM Workspaces w
        INNER JOIN WorkspaceUsers wu ON w.id = wu.workspaceId
        WHERE w.id = @id AND wu.userId = @userId AND wu.accessLevel = 'member'
      `;
    }
    
    // Verify workspace exists and user has access
    const workspaceCheck = await pool.request()
      .input('id', sql.NVarChar, id)
      .input('userId', sql.NVarChar, userId)
      .query(accessQuery);
    
    if (workspaceCheck.recordset.length === 0) {
      return res.status(404).json({
        error: 'Workspace not found',
        message: 'Workspace not found or access denied'
      });
    }
    
    // Get file to delete
    const fileResult = await pool.request()
      .input('fileId', sql.NVarChar, fileId)
      .input('workspaceId', sql.NVarChar, id)
      .query('SELECT * FROM WorkspaceFiles WHERE id = @fileId AND workspaceId = @workspaceId');
    
    if (fileResult.recordset.length === 0) {
      return res.status(404).json({
        error: 'File not found',
        message: 'File not found in this workspace'
      });
    }
    
    const file = fileResult.recordset[0];
    
    // Delete file from blob storage
    const isMockStorage = !process.env.AZURE_STORAGE_ACCOUNT_NAME || process.env.MOCK_STORAGE === 'true';
    
    if (!isMockStorage && blobServiceClient) {
      const containerName = `workspace-${id}`;
      const containerClient = blobServiceClient.getContainerClient(containerName);
      const blobClient = containerClient.getBlobClient(file.fileName);
      await blobClient.deleteIfExists();
    }
    
    // Delete file record from database
    await pool.request()
      .input('fileId', sql.NVarChar, fileId)
      .query('DELETE FROM WorkspaceFiles WHERE id = @fileId');
    
    res.json({
      message: 'File deleted successfully',
      fileId: fileId
    });
    
    logger.info(`File deleted from workspace ${id}: ${file.originalName} by user: ${userId}`);
  } catch (error) {
    logger.error('Delete workspace file error:', error);
    res.status(500).json({
      error: 'Failed to delete file',
      message: 'Please try again later'
    });
  }
});

export { router as workspaceRoutes };