import express from 'express';
import { DatabaseManager } from '../config/database';
import { logger } from '../utils/logger';
import sql from 'mssql';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();
const dbManager = DatabaseManager.getInstance();

// Middleware to check admin access (basic implementation)
const requireAdmin = async (req: any, res: any, next: any) => {
  try {
    // Allow multiple admin emails including the ones used in the mobile app
    const adminEmails = process.env.ADMIN_EMAILS?.split(',') || [
      'admin@aiva.com', 
      'admin@alyasra.com', 
      'sudhenreddym@gmail.com'
    ];
    const userEmail = req.user?.email || req.headers['x-admin-email'];
    
    logger.info(`Admin auth check - User email: ${userEmail}, Admin emails: ${adminEmails.join(', ')}`);
    
    if (!userEmail) {
      return res.status(403).json({
        error: 'Access denied',
        message: 'Admin email header required'
      });
    }
    
    if (!adminEmails.includes(userEmail)) {
      return res.status(403).json({
        error: 'Access denied',
        message: `Admin access required. Email ${userEmail} is not in admin list.`
      });
    }
    
    logger.info(`Admin access granted for: ${userEmail}`);
    next();
  } catch (error) {
    logger.error('Admin auth error:', error);
    res.status(500).json({ error: 'Authentication error' });
  }
};

// Get server configuration
router.get('/config', requireAdmin, async (req, res) => {
  try {
    const config = {
      database: {
        server: process.env.SQL_SERVER || 'Not configured',
        database: process.env.SQL_DATABASE || 'Not configured',
        username: process.env.SQL_USERNAME || 'Not configured',
        connectionStatus: 'Connected',
        lastChecked: new Date().toISOString()
      },
      openai: {
        apiKey: process.env.OPENAI_API_KEY ? 'Configured' : 'Not configured',
        model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
        endpoint: process.env.OPENAI_ENDPOINT || 'https://api.openai.com/v1'
      },
      azure: {
        tenantId: process.env.AZURE_TENANT_ID || 'Not configured',
        clientId: process.env.AZURE_CLIENT_ID || 'Not configured',
        fabricWorkspace: process.env.FABRIC_WORKSPACE_ID || 'Not configured',
        storageAccount: process.env.AZURE_STORAGE_ACCOUNT_NAME || 'Not configured'
      },
      security: {
        jwtSecret: process.env.JWT_SECRET ? 'Configured' : 'Not configured',
        sessionTimeout: process.env.SESSION_TIMEOUT || '24h',
        rateLimitEnabled: true,
        corsEnabled: true
      }
    };

    res.json(config);
  } catch (error) {
    logger.error('Get admin config error:', error);
    res.status(500).json({ error: 'Failed to retrieve configuration' });
  }
});

// Get system statistics
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const pool = await dbManager.getPool();
    
    // Get user statistics
    const userStats = await pool.request().query(`
      SELECT 
        COUNT(*) as totalUsers,
        SUM(CASE WHEN isActive = 1 THEN 1 ELSE 0 END) as activeUsers,
        SUM(CASE WHEN provider = 'local' THEN 1 ELSE 0 END) as localUsers,
        SUM(CASE WHEN lastLoginAt >= DATEADD(day, -7, GETUTCDATE()) THEN 1 ELSE 0 END) as weeklyActiveUsers
      FROM Users
    `);

    // Get chat statistics
    const chatStats = await pool.request().query(`
      SELECT 
        COUNT(*) as totalChats,
        SUM(CASE WHEN isArchived = 0 THEN 1 ELSE 0 END) as activeChats,
        AVG(messageCount) as avgMessagesPerChat
      FROM Chats
    `);

    // Get message statistics
    const messageStats = await pool.request().query(`
      SELECT 
        COUNT(*) as totalMessages,
        SUM(tokens) as totalTokens,
        AVG(tokens) as avgTokensPerMessage
      FROM Messages
    `);

    // Get recent activity
    const recentActivity = await pool.request().query(`
      SELECT TOP 10
        'Message' as type,
        m.content as description,
        u.firstName + ' ' + u.lastName as userName,
        m.createdAt as timestamp
      FROM Messages m
      JOIN Users u ON m.userId = u.id
      ORDER BY m.createdAt DESC
    `);

    res.json({
      users: userStats.recordset[0],
      chats: chatStats.recordset[0],
      messages: messageStats.recordset[0],
      recentActivity: recentActivity.recordset
    });
  } catch (error) {
    logger.error('Get admin stats error:', error);
    res.status(500).json({ error: 'Failed to retrieve statistics' });
  }
});

// Get all users
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;
    const pool = await dbManager.getPool();
    const offset = (Number(page) - 1) * Number(limit);
    
    // Simple query without complex JOINs
    let query = `
      SELECT 
        id, firstName, lastName, email, provider, providerId, 
        avatar, preferences, isActive, lastLoginAt, createdAt, updatedAt, role
      FROM Users
    `;
    
    let countQuery = `SELECT COUNT(*) as total FROM Users`;
    
    const request = pool.request()
      .input('limit', sql.Int, Number(limit))
      .input('offset', sql.Int, offset);
    
    if (search) {
      query += ` WHERE firstName LIKE @search OR lastName LIKE @search OR email LIKE @search`;
      countQuery += ` WHERE firstName LIKE @search OR lastName LIKE @search OR email LIKE @search`;
      request.input('search', sql.NVarChar, `%${search}%`);
    }
    
    query += ` ORDER BY createdAt DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`;
    
    const result = await request.query(query);
    
    const countRequest = pool.request();
    if (search) {
      countRequest.input('search', sql.NVarChar, `%${search}%`);
    }
    const countResult = await countRequest.query(countQuery);
    
    const total = countResult.recordset[0].total;

    // Add default values for missing fields
    const users = result.recordset.map(user => ({
      ...user,
      chatCount: 0,
      messageCount: 0,
      lastLogin: user.lastLoginAt
    }));

    res.json({
      users,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    logger.error('Get admin users error:', error);
    res.status(500).json({ error: 'Failed to retrieve users' });
  }
});

// Get disliked messages
router.get('/disliked-messages', requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '' } = req.query;
    const pool = await dbManager.getPool();
    const offset = (Number(page) - 1) * Number(limit);
    
    let whereClause = '';
    let searchInput = '';
    
    if (search) {
      whereClause = `AND (m.content LIKE @search OR c.title LIKE @search)`;
      searchInput = `%${search}%`;
    }
    
    const result = await pool.request()
      .input('limit', sql.Int, Number(limit))
      .input('offset', sql.Int, offset)
      .input('search', sql.NVarChar, searchInput)
      .query(`
        SELECT 
          m.id,
          m.content,
          m.role,
          m.createdAt,
          c.title as chatTitle,
          c.id as chatId,
          u.firstName + ' ' + u.lastName as userName,
          u.email as userEmail,
          ma.createdAt as dislikedAt,
          COUNT(*) OVER() as totalCount
        FROM Messages m
        JOIN MessageActions ma ON m.id = ma.messageId
        JOIN Chats c ON m.chatId = c.id
        JOIN Users u ON ma.userId = u.id
        WHERE ma.actionType = 'dislike' ${whereClause}
        ORDER BY ma.createdAt DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `);
    
    const messages = result.recordset.map(record => ({
      id: record.id,
      title: record.chatTitle,
      description: record.content.length > 100 ? record.content.substring(0, 100) + '...' : record.content,
      content: record.content,
      date: record.dislikedAt,
      type: record.role,
      category: 'Conversation',
      chatId: record.chatId,
      userName: record.userName,
      userEmail: record.userEmail
    }));
    
    const total = result.recordset.length > 0 ? result.recordset[0].totalCount : 0;

    res.json({
      messages,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    logger.error('Get disliked messages error:', error);
    res.status(500).json({ error: 'Failed to retrieve disliked messages' });
  }
});

// Get Azure service status
router.get('/azure-services', requireAdmin, async (req, res) => {
  try {
    const services = [
      {
        id: 'fabric',
        name: 'Microsoft Fabric',
        status: process.env.FABRIC_WORKSPACE_ID ? 'connected' : 'disconnected',
        lastChecked: new Date().toISOString(),
        workspaceId: process.env.FABRIC_WORKSPACE_ID || 'Not configured'
      },
      {
        id: 'blob-storage',
        name: 'Azure Blob Storage',
        status: process.env.AZURE_STORAGE_ACCOUNT_NAME ? 'connected' : 'disconnected',
        lastChecked: new Date().toISOString(),
        accountName: process.env.AZURE_STORAGE_ACCOUNT_NAME || 'Not configured'
      },
      {
        id: 'sql-database',
        name: 'Azure SQL Database',
        status: process.env.SQL_SERVER ? 'connected' : 'disconnected',
        lastChecked: new Date().toISOString(),
        server: process.env.SQL_SERVER || 'Not configured'
      },
      {
        id: 'openai',
        name: 'Azure OpenAI',
        status: process.env.AZURE_OPENAI_API_KEY ? 'connected' : 'disconnected',
        lastChecked: new Date().toISOString(),
        endpoint: process.env.AZURE_OPENAI_ENDPOINT || 'Not configured'
      },
      {
        id: 'active-directory',
        name: 'Azure Active Directory',
        status: process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_ID ? 'connected' : 'disconnected',
        lastChecked: new Date().toISOString(),
        tenantId: process.env.AZURE_TENANT_ID || 'Not configured'
      }
    ];

    res.json({ services });
  } catch (error) {
    logger.error('Get Azure services error:', error);
    res.status(500).json({ error: 'Failed to retrieve Azure services' });
  }
});

// Get system monitoring data
router.get('/monitoring', requireAdmin, async (req, res) => {
  try {
    // Simulate system metrics (in production, integrate with actual monitoring)
    const metrics = {
      cpu: Math.floor(Math.random() * 40) + 20, // 20-60%
      memory: Math.floor(Math.random() * 30) + 50, // 50-80%
      disk: Math.floor(Math.random() * 20) + 30, // 30-50%
      network: Math.floor(Math.random() * 100) + 50, // 50-150 Mbps
      activeUsers: Math.floor(Math.random() * 50) + 25,
      requestsPerMin: Math.floor(Math.random() * 200) + 100,
      responseTime: Math.floor(Math.random() * 100) + 50, // 50-150ms
      uptime: '99.8%'
    };

    // Get recent logs
    const pool = await dbManager.getPool();
    const recentLogs = await pool.request().query(`
      SELECT TOP 20
        'INFO' as level,
        'User ' + u.firstName + ' ' + u.lastName + ' sent a message' as message,
        m.createdAt as timestamp
      FROM Messages m
      JOIN Users u ON m.userId = u.id
      WHERE m.role = 'user'
      ORDER BY m.createdAt DESC
    `);

    res.json({
      metrics,
      logs: recentLogs.recordset
    });
  } catch (error) {
    logger.error('Get monitoring data error:', error);
    res.status(500).json({ error: 'Failed to retrieve monitoring data' });
  }
});

// Update configuration - redirect to new config routes
router.put('/config', requireAdmin, async (req, res) => {
  try {
    // This endpoint is deprecated in favor of /api/admin/config/:section
    res.status(301).json({
      message: 'This endpoint has been moved',
      redirectTo: '/api/admin/config',
      deprecated: true
    });
  } catch (error) {
    logger.error('Update admin config error:', error);
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

// Get all feedback
router.get('/feedback', requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', status = '', category = '' } = req.query;
    const pool = await dbManager.getPool();
    const offset = (Number(page) - 1) * Number(limit);
    
    let whereClause = 'WHERE 1=1';
    const inputs: any = {
      limit: Number(limit),
      offset: offset
    };
    
    if (search) {
      whereClause += ` AND (f.subject LIKE @search OR f.message LIKE @search OR u.firstName LIKE @search OR u.lastName LIKE @search)`;
      inputs.search = `%${search}%`;
    }
    
    if (status) {
      whereClause += ` AND f.status = @status`;
      inputs.status = status;
    }
    
    if (category) {
      whereClause += ` AND f.category = @category`;
      inputs.category = category;
    }
    
    const request = pool.request();
    Object.keys(inputs).forEach(key => {
      if (key === 'limit' || key === 'offset') {
        request.input(key, sql.Int, inputs[key]);
      } else {
        request.input(key, sql.NVarChar, inputs[key]);
      }
    });
    
    const result = await request.query(`
      SELECT 
        f.*,
        u.firstName + ' ' + u.lastName as userName,
        u.email as userEmail,
        a.firstName + ' ' + a.lastName as adminName
      FROM Feedback f
      JOIN Users u ON f.userId = u.id
      LEFT JOIN Users a ON f.adminId = a.id
      ${whereClause}
      ORDER BY f.createdAt DESC
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `);
    
    const countRequest = pool.request();
    Object.keys(inputs).filter(k => k !== 'limit' && k !== 'offset').forEach(key => {
      countRequest.input(key, sql.NVarChar, inputs[key]);
    });
    
    const countResult = await countRequest.query(`
      SELECT COUNT(*) as total 
      FROM Feedback f
      JOIN Users u ON f.userId = u.id
      ${whereClause}
    `);
    
    const total = countResult.recordset[0].total;

    res.json({
      feedback: result.recordset,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    logger.error('Get admin feedback error:', error);
    res.status(500).json({ error: 'Failed to retrieve feedback' });
  }
});

// Respond to feedback
router.post('/feedback/:id/respond', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { response, status = 'resolved' } = req.body;
    const adminEmail = req.headers['x-admin-email'];
    
    if (!response) {
      return res.status(400).json({ error: 'Response is required' });
    }

    const pool = await dbManager.getPool();
    
    // Get admin user ID
    const adminResult = await pool.request()
      .input('email', sql.NVarChar, adminEmail)
      .query('SELECT id FROM Users WHERE email = @email');
    
    if (adminResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Admin user not found' });
    }
    
    const adminId = adminResult.recordset[0].id;
    
    // Update feedback with response
    await pool.request()
      .input('id', sql.NVarChar, id)
      .input('response', sql.NVarChar, response)
      .input('status', sql.NVarChar, status)
      .input('adminId', sql.NVarChar, adminId)
      .input('respondedAt', sql.DateTime2, new Date())
      .input('updatedAt', sql.DateTime2, new Date())
      .query(`
        UPDATE Feedback 
        SET adminResponse = @response, 
            status = @status, 
            adminId = @adminId, 
            respondedAt = @respondedAt,
            updatedAt = @updatedAt
        WHERE id = @id
      `);

    logger.info('Feedback response sent:', { feedbackId: id, adminId });

    res.json({
      message: 'Response sent successfully'
    });
  } catch (error) {
    logger.error('Send feedback response error:', error);
    res.status(500).json({ error: 'Failed to send response' });
  }
});

// Duplicate route removed - using the first /users endpoint above

// Create new user (admin only)
router.post('/users', requireAdmin, async (req, res) => {
  try {
    const { firstName, lastName, email, password = 'TempPassword123!', role = 'user', provider = 'microsoft' } = req.body;
    
    if (!email) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        message: 'email is required' 
      });
    }
    
    // Auto-generate names if not provided (for Microsoft users)
    const finalFirstName = firstName || email.split('@')[0];
    const finalLastName = lastName || 'User';
    
    logger.info('Creating user:', { firstName: finalFirstName, lastName: finalLastName, email, provider, role });
    
    const pool = await dbManager.getPool();
    
    // Check if user already exists
    const existingUser = await pool.request()
      .input('email', sql.NVarChar, email.toLowerCase())
      .query('SELECT id FROM Users WHERE email = @email');
    
    if (existingUser.recordset.length > 0) {
      return res.status(409).json({ 
        error: 'User already exists',
        message: 'A user with this email already exists' 
      });
    }
    
    // Hash password
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(password, 12);
    const userId = require('uuid').v4();
    
    // Create user
    await pool.request()
      .input('id', sql.NVarChar, userId)
      .input('firstName', sql.NVarChar, finalFirstName)
      .input('lastName', sql.NVarChar, finalLastName)
      .input('email', sql.NVarChar, email.toLowerCase())
      .input('password', sql.NVarChar, hashedPassword)
      .input('provider', sql.NVarChar, provider) // Use the provider from request (microsoft by default)
      .input('role', sql.NVarChar, role)
      .input('createdAt', sql.DateTime2, new Date())
      .input('updatedAt', sql.DateTime2, new Date())
      .query(`
        INSERT INTO Users (id, firstName, lastName, email, password, provider, role, createdAt, updatedAt)
        VALUES (@id, @firstName, @lastName, @email, @password, @provider, @role, @createdAt, @updatedAt)
      `);
    
    logger.info('User created by admin:', { userId, email, role });
    
    res.status(201).json({
      message: 'User created successfully',
      user: {
        id: userId,
        firstName: finalFirstName,
        lastName: finalLastName,
        email: email.toLowerCase(),
        role,
        provider, // Use the actual provider from the request
        createdAt: new Date()
      }
    });
  } catch (error) {
    logger.error('Create user error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Update user (admin only)
router.put('/users/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, email, isActive, role } = req.body;
    
    if (!id) {
      return res.status(400).json({ 
        error: 'Missing required parameter',
        message: 'User ID is required' 
      });
    }
    
    logger.info('Updating user:', { userId: id, updates: req.body });
    
    const pool = await dbManager.getPool();
    
    // Check if user exists
    const existingUser = await pool.request()
      .input('id', sql.NVarChar, id)
      .query('SELECT id, email FROM Users WHERE id = @id');
    
    if (existingUser.recordset.length === 0) {
      return res.status(404).json({ 
        error: 'User not found',
        message: 'User with this ID does not exist' 
      });
    }
    
    const userEmail = existingUser.recordset[0].email;
    
    // Prevent modification of admin users' critical fields
    const adminEmails = process.env.ADMIN_EMAILS?.split(',') || [
      'admin@aiva.com', 
      'admin@alyasra.com', 
      'sudhenreddym@gmail.com'
    ];
    
    if (adminEmails.includes(userEmail) && (role !== 'admin' || isActive === false)) {
      return res.status(403).json({ 
        error: 'Cannot modify admin user',
        message: 'Admin users cannot be deactivated or have their role changed' 
      });
    }
    
    // Build dynamic update query
    const updateFields = [];
    const request = pool.request().input('id', sql.NVarChar, id);
    
    if (firstName !== undefined) {
      updateFields.push('firstName = @firstName');
      request.input('firstName', sql.NVarChar, firstName);
    }
    
    if (lastName !== undefined) {
      updateFields.push('lastName = @lastName');
      request.input('lastName', sql.NVarChar, lastName);
    }
    
    if (email !== undefined) {
      updateFields.push('email = @email');
      request.input('email', sql.NVarChar, email);
    }
    
    if (isActive !== undefined) {
      updateFields.push('isActive = @isActive');
      request.input('isActive', sql.Bit, isActive);
    }
    
    if (role !== undefined) {
      updateFields.push('role = @role');
      request.input('role', sql.NVarChar, role);
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ 
        error: 'No fields to update',
        message: 'At least one field must be provided for update' 
      });
    }
    
    updateFields.push('updatedAt = GETUTCDATE()');
    
    const updateQuery = `
      UPDATE Users 
      SET ${updateFields.join(', ')}
      OUTPUT INSERTED.*
      WHERE id = @id
    `;
    
    const result = await request.query(updateQuery);
    
    if (result.recordset.length === 0) {
      return res.status(404).json({ 
        error: 'Update failed',
        message: 'User not found or no changes made' 
      });
    }
    
    const updatedUser = result.recordset[0];
    
    // Remove sensitive fields from response
    delete updatedUser.password;
    
    logger.info('User updated successfully:', { userId: id, email: updatedUser.email });
    
    res.json({
      message: 'User updated successfully',
      user: updatedUser
    });
    
  } catch (error) {
    logger.error('Update user error:', error);
    res.status(500).json({ 
      error: 'Failed to update user',
      message: (error as Error).message || 'Unknown error occurred'
    });
  }
});

// Delete user (admin only)
router.delete('/users/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ 
        error: 'Missing required parameter',
        message: 'User ID is required' 
      });
    }
    
    logger.info('Deleting user:', { userId: id });
    
    const pool = await dbManager.getPool();
    
    // Check if user exists
    const existingUser = await pool.request()
      .input('id', sql.NVarChar, id)
      .query('SELECT id, email FROM Users WHERE id = @id');
    
    if (existingUser.recordset.length === 0) {
      return res.status(404).json({ 
        error: 'User not found',
        message: 'User with this ID does not exist' 
      });
    }
    
    const userEmail = existingUser.recordset[0].email;
    
    // Prevent deletion of admin users
    const adminEmails = process.env.ADMIN_EMAILS?.split(',') || [
      'admin@aiva.com', 
      'admin@alyasra.com', 
      'sudhenreddym@gmail.com'
    ];
    
    if (adminEmails.includes(userEmail)) {
      return res.status(403).json({ 
        error: 'Cannot delete admin user',
        message: 'Admin users cannot be deleted' 
      });
    }
    
    // Delete user
    await pool.request()
      .input('id', sql.NVarChar, id)
      .query('DELETE FROM Users WHERE id = @id');
    
    logger.info('User deleted successfully:', { userId: id, email: userEmail });
    
    res.json({
      message: 'User deleted successfully',
      deletedUser: {
        id,
        email: userEmail
      }
    });
  } catch (error) {
    logger.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Bulk delete users (admin only)
router.post('/users/bulk-delete', requireAdmin, async (req, res) => {
  try {
    const { userIds } = req.body;
    
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'userIds array is required and cannot be empty'
      });
    }
    
    logger.info(`Bulk delete request for ${userIds.length} users:`, userIds);
    
    const pool = await dbManager.getPool();
    const adminEmails = process.env.ADMIN_EMAILS?.split(',') || [
      'admin@aiva.com', 
      'admin@alyasra.com', 
      'sudhenreddym@gmail.com'
    ];
    
    const results: {
      deleted: Array<{ id: string; email: string }>;
      failed: Array<{ id: string; reason: string }>;
      adminProtected: Array<{ id: string; email: string }>;
    } = {
      deleted: [],
      failed: [],
      adminProtected: []
    };
    
    // Process each user ID
    for (const userId of userIds) {
      try {
        // Check if user exists and get email
        const existingUser = await pool.request()
          .input('id', sql.NVarChar, userId)
          .query('SELECT id, email FROM Users WHERE id = @id');
        
        if (existingUser.recordset.length === 0) {
          results.failed.push({ id: userId, reason: 'User not found' });
          continue;
        }
        
        const userEmail = existingUser.recordset[0].email;
        
        // Prevent deletion of admin users
        if (adminEmails.includes(userEmail)) {
          results.adminProtected.push({ id: userId, email: userEmail });
          continue;
        }
        
        // Delete user
        await pool.request()
          .input('id', sql.NVarChar, userId)
          .query('DELETE FROM Users WHERE id = @id');
        
        results.deleted.push({ id: userId, email: userEmail });
        logger.info(`User deleted in bulk operation:`, { userId, email: userEmail });
        
      } catch (error) {
        logger.error(`Failed to delete user ${userId}:`, error);
        results.failed.push({ id: userId, reason: 'Database error' });
      }
    }
    
    // Prepare response message
    let message = `Bulk delete completed. `;
    if (results.deleted.length > 0) {
      message += `${results.deleted.length} users deleted. `;
    }
    if (results.adminProtected.length > 0) {
      message += `${results.adminProtected.length} admin users protected. `;
    }
    if (results.failed.length > 0) {
      message += `${results.failed.length} users failed to delete.`;
    }
    
    const statusCode = results.deleted.length > 0 ? 200 : 400;
    
    res.status(statusCode).json({
      message,
      results
    });
    
  } catch (error) {
    logger.error('Bulk delete users error:', error);
    res.status(500).json({ 
      error: 'Failed to bulk delete users',
      message: (error as Error).message || 'Unknown error occurred'
    });
  }
});

// Simple test endpoint
router.get('/test-users', requireAdmin, async (req, res) => {
  try {
    const pool = await dbManager.getPool();
    const result = await pool.request().query('SELECT TOP 5 id, firstName, lastName, email FROM Users');
    res.json({ users: result.recordset });
  } catch (error) {
    logger.error('Test users error:', error);
    res.status(500).json({ 
      error: 'Test failed'
    });
  }
});

// Assign one or more workspaces to a specific user (admin only)
router.post('/users/:userId/assign-workspaces', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { workspaceIds, accessLevel = 'member' } = req.body || {};
    const adminEmail = (req.user && req.user.email) || (req.headers['x-admin-email'] as string | undefined);

    if (!userId || !Array.isArray(workspaceIds) || workspaceIds.length === 0) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'userId param and workspaceIds[] are required'
      });
    }

    const validLevels = ['member', 'readonly', 'owner'];
    const finalAccess = validLevels.includes(accessLevel) ? accessLevel : 'member';

    const pool = await dbManager.getPool();

    // Verify target user exists
    const userCheck = await pool.request()
      .input('userId', sql.VarChar, userId)
      .query('SELECT id FROM Users WHERE id = @userId');
    if (userCheck.recordset.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Resolve adminId from email (optional)
    let adminId: string | null = null;
    if (adminEmail) {
      const adminRes = await pool.request()
        .input('email', sql.VarChar, adminEmail)
        .query('SELECT id FROM Users WHERE email = @email');
      if (adminRes.recordset.length > 0) adminId = adminRes.recordset[0].id;
    }

    const results: { assigned: Array<{ workspaceId: string; accessLevel: string }>; updated: Array<{ workspaceId: string; accessLevel: string }>; failed: Array<{ workspaceId: string; reason: string }>; } = { assigned: [], updated: [], failed: [] };

    for (const workspaceId of workspaceIds) {
      try {
        // Verify workspace exists
        const wsCheck = await pool.request()
          .input('workspaceId', sql.VarChar, workspaceId)
          .query('SELECT id FROM Workspaces WHERE id = @workspaceId');
        if (wsCheck.recordset.length === 0) {
          results.failed.push({ workspaceId, reason: 'Workspace not found' });
          continue;
        }

        // Upsert into WorkspaceUsers
        const existing = await pool.request()
          .input('workspaceId', sql.VarChar, workspaceId)
          .input('userId', sql.VarChar, userId)
          .query('SELECT id FROM WorkspaceUsers WHERE workspaceId = @workspaceId AND userId = @userId');

        if (existing.recordset.length > 0) {
          await pool.request()
            .input('workspaceId', sql.VarChar, workspaceId)
            .input('userId', sql.VarChar, userId)
            .input('accessLevel', sql.VarChar, finalAccess)
            .query('UPDATE WorkspaceUsers SET accessLevel = @accessLevel, updatedAt = GETUTCDATE() WHERE workspaceId = @workspaceId AND userId = @userId');
          results.updated.push({ workspaceId, accessLevel: finalAccess });
        } else {
          await pool.request()
            .input('id', sql.VarChar, uuidv4())
            .input('workspaceId', sql.VarChar, workspaceId)
            .input('userId', sql.VarChar, userId)
            .input('accessLevel', sql.VarChar, finalAccess)
            .input('assignedBy', sql.VarChar, adminId || userId)
            .query(`
              INSERT INTO WorkspaceUsers (id, workspaceId, userId, accessLevel, assignedBy, assignedAt, createdAt, updatedAt)
              VALUES (@id, @workspaceId, @userId, @accessLevel, @assignedBy, GETUTCDATE(), GETUTCDATE(), GETUTCDATE())
            `);
          results.assigned.push({ workspaceId, accessLevel: finalAccess });
        }
      } catch (err) {
        logger.error('Assign workspace failed', { workspaceId, userId, err });
        results.failed.push({ workspaceId, reason: 'Database error' });
      }
    }

    return res.json({ message: 'Workspace assignment completed', userId, results });
  } catch (error) {
    logger.error('Assign workspaces error:', error);
    res.status(500).json({ error: 'Failed to assign workspaces' });
  }
});

export { router as adminRoutes };