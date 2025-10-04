import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { validate, schemas } from '../middleware/validation';
import { DatabaseManager } from '../config/database';
import { logger } from '../utils/logger';
import sql from 'mssql';

const router = express.Router();

// Apply authentication to all search routes
router.use(authenticateToken);

const dbManager = DatabaseManager.getInstance();

// Global search across chats, messages, and files
router.get('/', validate(schemas.search), async (req, res) => {
  try {
    const { q: query, type, page = 1, limit = 10 } = req.query;
    const userId = req.user.userId;
    const offset = (Number(page) - 1) * Number(limit);
    
    const pool = await dbManager.getPool();
    const searchTerm = `%${query}%`;
    
    let results: any = {};
    
    if (!type || type === 'chats') {
      // Search chats
      const chatResults = await pool.request()
        .input('userId', sql.NVarChar, userId)
        .input('searchTerm', sql.NVarChar, searchTerm)
        .input('limit', sql.Int, Number(limit))
        .input('offset', sql.Int, offset)
        .query(`
          SELECT 
            c.*,
            w.name as workspaceName,
            (SELECT COUNT(*) FROM Messages WHERE chatId = c.id) as messageCount
          FROM Chats c
          LEFT JOIN Workspaces w ON c.workspaceId = w.id
          WHERE c.userId = @userId 
            AND c.isArchived = 0
            AND (c.title LIKE @searchTerm OR c.description LIKE @searchTerm)
          ORDER BY c.updatedAt DESC
          OFFSET @offset ROWS
          FETCH NEXT @limit ROWS ONLY
        `);
      
      results.chats = chatResults.recordset;
    }
    
    if (!type || type === 'messages') {
      // Search messages
      const messageResults = await pool.request()
        .input('userId', sql.NVarChar, userId)
        .input('searchTerm', sql.NVarChar, searchTerm)
        .input('limit', sql.Int, Number(limit))
        .input('offset', sql.Int, offset)
        .query(`
          SELECT 
            m.*,
            c.title as chatTitle,
            w.name as workspaceName
          FROM Messages m
          JOIN Chats c ON m.chatId = c.id
          LEFT JOIN Workspaces w ON c.workspaceId = w.id
          WHERE c.userId = @userId 
            AND c.isArchived = 0
            AND m.content LIKE @searchTerm
          ORDER BY m.createdAt DESC
          OFFSET @offset ROWS
          FETCH NEXT @limit ROWS ONLY
        `);
      
      results.messages = messageResults.recordset;
    }
    
    if (!type || type === 'files') {
      // Search files
      const fileResults = await pool.request()
        .input('userId', sql.NVarChar, userId)
        .input('searchTerm', sql.NVarChar, searchTerm)
        .input('limit', sql.Int, Number(limit))
        .input('offset', sql.Int, offset)
        .query(`
          SELECT 
            f.*,
            c.title as chatTitle
          FROM Files f
          LEFT JOIN Chats c ON f.chatId = c.id
          WHERE f.userId = @userId 
            AND f.originalName LIKE @searchTerm
          ORDER BY f.createdAt DESC
          OFFSET @offset ROWS
          FETCH NEXT @limit ROWS ONLY
        `);
      
      results.files = fileResults.recordset;
    }

    res.json({
      message: 'Search completed successfully',
      query,
      results,
      pagination: {
        page: Number(page),
        limit: Number(limit)
      }
    });
  } catch (error) {
    logger.error('Search error:', error);
    res.status(500).json({
      error: 'Search failed',
      message: 'An error occurred while searching'
    });
  }
});

// Search within a specific chat
router.get('/chats/:chatId', validate(schemas.chatIdParam), async (req, res) => {
  try {
    const { chatId } = req.params;
    const { q: query, page = 1, limit = 20 } = req.query;
    const userId = req.user.userId;
    const offset = (Number(page) - 1) * Number(limit);
    
    if (!query) {
      return res.status(400).json({
        error: 'Query parameter required',
        message: 'Please provide a search query'
      });
    }
    
    const pool = await dbManager.getPool();
    
    // Verify chat belongs to user
    const chatCheck = await pool.request()
      .input('chatId', sql.NVarChar, chatId)
      .input('userId', sql.NVarChar, userId)
      .query('SELECT id FROM Chats WHERE id = @chatId AND userId = @userId');
    
    if (chatCheck.recordset.length === 0) {
      return res.status(404).json({
        error: 'Chat not found',
        message: 'Chat not found or access denied'
      });
    }
    
    const searchTerm = `%${query}%`;
    
    const messageResults = await pool.request()
      .input('chatId', sql.NVarChar, chatId)
      .input('searchTerm', sql.NVarChar, searchTerm)
      .input('limit', sql.Int, Number(limit))
      .input('offset', sql.Int, offset)
      .query(`
        SELECT *
        FROM Messages
        WHERE chatId = @chatId 
          AND content LIKE @searchTerm
        ORDER BY createdAt DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `);
    
    const countResult = await pool.request()
      .input('chatId', sql.NVarChar, chatId)
      .input('searchTerm', sql.NVarChar, searchTerm)
      .query(`
        SELECT COUNT(*) as total
        FROM Messages
        WHERE chatId = @chatId AND content LIKE @searchTerm
      `);
    
    const total = countResult.recordset[0].total;

    res.json({
      message: 'Chat search completed successfully',
      query,
      chatId,
      messages: messageResults.recordset,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    logger.error('Chat search error:', error);
    res.status(500).json({
      error: 'Chat search failed',
      message: 'An error occurred while searching the chat'
    });
  }
});

// Get search suggestions
router.get('/suggestions', async (req, res) => {
  try {
    const { q: query } = req.query;
    const userId = req.user.userId;
    
    if (!query || typeof query !== 'string' || query.length < 2) {
      return res.json({
        suggestions: []
      });
    }
    
    const pool = await dbManager.getPool();
    const searchTerm = `%${query}%`;
    
    // Get chat title suggestions
    const chatSuggestions = await pool.request()
      .input('userId', sql.NVarChar, userId)
      .input('searchTerm', sql.NVarChar, searchTerm)
      .query(`
        SELECT TOP 5 title, 'chat' as type, id
        FROM Chats
        WHERE userId = @userId 
          AND isArchived = 0
          AND title LIKE @searchTerm
        ORDER BY updatedAt DESC
      `);
    
    // Get recent message content suggestions
    const messageSuggestions = await pool.request()
      .input('userId', sql.NVarChar, userId)
      .input('searchTerm', sql.NVarChar, searchTerm)
      .query(`
        SELECT TOP 3 
          SUBSTRING(content, 1, 100) as title, 
          'message' as type, 
          chatId as id
        FROM Messages m
        JOIN Chats c ON m.chatId = c.id
        WHERE c.userId = @userId 
          AND c.isArchived = 0
          AND m.content LIKE @searchTerm
        ORDER BY m.createdAt DESC
      `);

    const suggestions = [
      ...chatSuggestions.recordset,
      ...messageSuggestions.recordset
    ];

    res.json({
      suggestions
    });
  } catch (error) {
    logger.error('Search suggestions error:', error);
    res.status(500).json({
      error: 'Failed to get search suggestions'
    });
  }
});

export { router as searchRoutes };