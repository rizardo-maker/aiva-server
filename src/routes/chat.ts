import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticateToken } from '../middleware/auth';
import { AIDataService } from '../services/aiDataService';
import { validate, schemas } from '../middleware/validation';
import { chatLimiter, aiLimiter } from '../middleware/rateLimiter';
import { DatabaseManager } from '../config/database';
import { OpenAIService, ChatMessage } from '../services/openai';
import { CacheService } from '../services/cache';
import { FileAnalysisService } from '../services/fileAnalysisService';
import { logger } from '../utils/logger';
import sql from 'mssql';
import multer from 'multer';

const router = express.Router();
const dbManager = DatabaseManager.getInstance();

// Apply authentication to all chat routes
router.use(authenticateToken);

// Get services
const openAIService = OpenAIService.getInstance();
const cacheService = CacheService.getInstance();
const aiDataService = AIDataService.getInstance();
const fileAnalysisService = FileAnalysisService.getInstance();

// Lightweight audit logging helper for Q&A interactions
async function logAudit(pool: any, params: { userId: string; workspaceId?: string | null; action: string; details?: string }) {
  try {
    if (!params.workspaceId) return; // Only log if workspace context is present
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
    logger.debug('Audit log skipped', { action: params.action, err: (e as Error)?.message });
  }
}
// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

// Helper function to detect data-related keywords
function containsDataKeywords(message: string): boolean {
  const dataKeywords = [
    'chart', 'graph', 'plot', 'visualization', 'data', 'analytics', 
    'report', 'dashboard', 'metrics', 'statistics', 'analysis',
    'sales', 'revenue', 'profit', 'customers', 'orders', 'products',
    'show me', 'display', 'visualize', 'create a chart', 'generate report'
  ];
  
  const lowerMessage = message.toLowerCase();
  return dataKeywords.some(keyword => lowerMessage.includes(keyword));
}

// Get user's chats
router.get('/', validate(schemas.pagination), async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 20, sortBy = 'updatedAt', sortOrder = 'desc' } = req.query;
    
    const pool = await dbManager.getPool();
    const offset = (Number(page) - 1) * Number(limit);
    
    const result = await pool.request()
      .input('userId', sql.NVarChar, userId)
      .input('limit', sql.Int, Number(limit))
      .input('offset', sql.Int, offset)
      .query(`
        SELECT 
          c.*,
          w.name as workspaceName,
          w.color as workspaceColor,
          (SELECT COUNT(*) FROM Messages WHERE chatId = c.id) as messageCount
        FROM Chats c
        LEFT JOIN Workspaces w ON c.workspaceId = w.id
        WHERE c.userId = @userId AND c.isArchived = 0
        ORDER BY c.${sortBy} ${sortOrder}
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `);
    
    const countResult = await pool.request()
      .input('userId', sql.NVarChar, userId)
      .query('SELECT COUNT(*) as total FROM Chats WHERE userId = @userId AND isArchived = 0');
    
    const total = countResult.recordset[0].total;

    res.json({
      message: 'Chats retrieved successfully',
      chats: result.recordset,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    logger.error('Get chats error:', error);
    res.status(500).json({
      error: 'Failed to retrieve chats'
    });
  }
});

// Create new chat
router.post('/', validate(schemas.createChat), async (req, res) => {
  try {
    const { title, description, workspaceId } = req.body;
    const userId = req.user.userId;
    const chatId = uuidv4();

    const pool = await dbManager.getPool();
    
    // In development mode with bypass auth, we might need to create the user
    if (process.env.NODE_ENV === 'development' && process.env.BYPASS_AUTH === 'true') {
      // Check if user exists
      const userCheck = await pool.request()
        .input('userId', sql.NVarChar, userId)
        .query('SELECT id FROM Users WHERE id = @userId');
      
      if (userCheck.recordset.length === 0) {
        // Check if a user with the same email already exists
        const emailCheck = await pool.request()
          .input('email', sql.NVarChar, `${userId}@example.com`)
          .query('SELECT id FROM Users WHERE email = @email');
        
        if (emailCheck.recordset.length === 0) {
          // Create the mock user only if no user with this email exists
          await pool.request()
            .input('id', sql.NVarChar, userId)
            .input('firstName', sql.NVarChar, 'Test')
            .input('lastName', sql.NVarChar, 'User')
            .input('email', sql.NVarChar, `${userId}@example.com`)
            .input('role', sql.NVarChar, req.user.role || 'user')
            .query(`
              INSERT INTO Users (id, firstName, lastName, email, role, isActive, createdAt, updatedAt)
              VALUES (@id, @firstName, @lastName, @email, @role, 1, GETUTCDATE(), GETUTCDATE())
            `);
        } else {
          // If user with email exists, update the user ID
          await pool.request()
            .input('id', sql.NVarChar, userId)
            .input('email', sql.NVarChar, `${userId}@example.com`)
            .query(`
              UPDATE Users SET id = @id WHERE email = @email
            `);
        }
      }
    }
    
    let finalWorkspaceId = workspaceId;
    
    // If no workspaceId provided, create a default workspace
    if (!finalWorkspaceId) {
      // Check if user has any workspaces
      const workspaceCheck = await pool.request()
        .input('userId', sql.NVarChar, userId)
        .query('SELECT TOP 1 id FROM Workspaces WHERE ownerId = @userId');
      
      if (workspaceCheck.recordset.length > 0) {
        finalWorkspaceId = workspaceCheck.recordset[0].id;
      } else {
        // Create a default workspace for the user
        const defaultWorkspaceId = uuidv4();
        const workspaceResult = await pool.request()
          .input('id', sql.VarChar, defaultWorkspaceId)
          .input('name', sql.VarChar, 'Default Workspace')
          .input('description', sql.VarChar, 'Auto-created default workspace')
          .input('color', sql.VarChar, '#3B82F6')
          .input('ownerId', sql.VarChar, userId)
          .query(`
            INSERT INTO Workspaces (id, name, description, color, ownerId, createdAt, updatedAt)
            OUTPUT INSERTED.id
            VALUES (@id, @name, @description, @color, @ownerId, GETUTCDATE(), GETUTCDATE())
          `);
        
        finalWorkspaceId = workspaceResult.recordset[0].id;
        logger.info(`Created default workspace ${finalWorkspaceId} for user ${userId}`);
      }
    } else {
      // Verify workspace access: owner OR assigned via WorkspaceUsers
      const workspaceCheck = await pool.request()
        .input('workspaceId', sql.NVarChar, finalWorkspaceId)
        .input('userId', sql.NVarChar, userId)
        .query(`
          SELECT w.id
          FROM Workspaces w
          WHERE w.id = @workspaceId 
            AND (
              w.ownerId = @userId OR 
              EXISTS (SELECT 1 FROM WorkspaceUsers wu WHERE wu.workspaceId = w.id AND wu.userId = @userId)
            )
        `);
      
      if (workspaceCheck.recordset.length === 0) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'Workspace not found or access denied'
        });
      }
    }

    const result = await pool.request()
      .input('id', sql.NVarChar, chatId)
      .input('title', sql.NVarChar, title)
      .input('description', sql.NVarChar, description || '')
      .input('userId', sql.NVarChar, userId)
      .input('workspaceId', sql.NVarChar, finalWorkspaceId)
      .query(`
        INSERT INTO Chats (id, title, description, userId, workspaceId, createdAt, updatedAt)
        OUTPUT INSERTED.*
        VALUES (@id, @title, @description, @userId, @workspaceId, GETUTCDATE(), GETUTCDATE())
      `);
    
    const chat = result.recordset[0];

    res.status(201).json({
      message: 'Chat created successfully',
      chat
    });

    logger.info(`Chat created: ${chatId} for user: ${userId}`);
  
  // Audit: chat created under a workspace
  try {
    await logAudit(pool, { userId, workspaceId: finalWorkspaceId, action: 'workspace.chat.create', details: title });
  } catch (error) {
    logger.warn('Audit log failed:', error);
  }
  } catch (error) {
    logger.error('Create chat error:', error);
    res.status(500).json({
      error: 'Failed to create chat'
    });
  }
});

// Send message and get AI response (with file support)
router.post('/message', upload.array('files'), chatLimiter, aiLimiter, validate(schemas.sendMessage), async (req, res) => {
  try {
    const { message, chatId, parentMessageId } = req.body;
    const { datasetId, workspaceId, useDataAgent } = req.body;
    const userId = req.user.userId;
    const files = req.files as Express.Multer.File[];
    let currentChatId = chatId;
    
    const pool = await dbManager.getPool();

    // Create new chat if chatId not provided
    if (!currentChatId) {
      currentChatId = uuidv4();
      const title = message.substring(0, 50) + (message.length > 50 ? '...' : '');
      
      // If a workspaceId is provided, verify access (owner or assigned) and attach to chat
      let newWorkspaceId: string | null = null;
      if (workspaceId) {
        const wsAccess = await pool.request()
          .input('workspaceId', sql.NVarChar, workspaceId)
          .input('userId', sql.NVarChar, userId)
          .query(`
            SELECT w.id
            FROM Workspaces w
            WHERE w.id = @workspaceId 
              AND (
                w.ownerId = @userId OR 
                EXISTS (SELECT 1 FROM WorkspaceUsers wu WHERE wu.workspaceId = w.id AND wu.userId = @userId)
              )
          `);
        if (wsAccess.recordset.length === 0) {
          return res.status(403).json({
            error: 'Access denied',
            message: 'You do not have access to this workspace'
          });
        }
        newWorkspaceId = workspaceId;
      }

      const insertReq = pool.request()
        .input('id', sql.NVarChar, currentChatId)
        .input('title', sql.NVarChar, title)
        .input('description', sql.NVarChar, 'Auto-generated chat')
        .input('userId', sql.NVarChar, userId);
      
      if (newWorkspaceId) {
        insertReq.input('workspaceId', sql.NVarChar, newWorkspaceId);
        await insertReq.query(`
          INSERT INTO Chats (id, title, description, userId, workspaceId, createdAt, updatedAt)
          VALUES (@id, @title, @description, @userId, @workspaceId, GETUTCDATE(), GETUTCDATE())
        `);
      } else {
        await insertReq.query(`
          INSERT INTO Chats (id, title, description, userId, createdAt, updatedAt)
          VALUES (@id, @title, @description, @userId, GETUTCDATE(), GETUTCDATE())
        `);
      }
    } else {
      // Verify chat belongs to user
      const chatCheck = await pool.request()
        .input('chatId', sql.NVarChar, currentChatId)
        .input('userId', sql.NVarChar, userId)
        .query('SELECT id FROM Chats WHERE id = @chatId AND userId = @userId');
      
      if (chatCheck.recordset.length === 0) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'Chat not found or access denied'
        });
      }
    }

    // Process file attachments if any
    let fileContents = '';
    if (files && files.length > 0) {
      try {
        const fileContentResults = [];
        for (const file of files) {
          try {
            // Create a temporary buffer-based extraction for uploaded files
            const content = await fileAnalysisService.extractFileContent(
              file.filename || file.originalname,
              file.originalname
            );
            fileContentResults.push({
              name: file.originalname,
              content: content.content
            });
          } catch (fileError) {
            logger.error(`Error processing file ${file.originalname}:`, fileError);
            fileContentResults.push({
              name: file.originalname,
              content: `[Error processing file: ${file.originalname}]`
            });
          }
        }
        
        // Format file contents for the AI
        if (fileContentResults.length > 0) {
          fileContents = fileContentResults.map((f: any) => 
            `File: ${f.name}
Content:
${f.content}
---
`
          ).join('\n');
        }
      } catch (fileProcessingError) {
        logger.error('Error processing files:', fileProcessingError);
      }
    }

    // Combine message with file contents
    let fullMessage = message;
    if (fileContents) {
      fullMessage = `${message}\n\nAttached Files:\n${fileContents}`;
    }

    // Save user message
    const userMessageId = uuidv4();
    const userMessageResult = await pool.request()
      .input('id', sql.NVarChar, userMessageId)
      .input('chatId', sql.NVarChar, currentChatId)
      .input('userId', sql.NVarChar, userId)
      .input('content', sql.NVarChar, fullMessage)
      .input('role', sql.NVarChar, 'user')
      .query(`
        INSERT INTO Messages (id, chatId, userId, content, role)
        OUTPUT INSERTED.*
        VALUES (@id, @chatId, @userId, @content, @role)
      `);

    const userMessageData = userMessageResult.recordset[0];

    // Get chat history for context
    const cacheKey = `chat_history:${currentChatId}`;
    let chatHistory = cacheService.get(cacheKey);
    
    if (!chatHistory) {
      const historyResult = await pool.request()
        .input('chatId', sql.NVarChar, currentChatId)
        .query(`
          SELECT TOP 20 content, role, createdAt
          FROM Messages 
          WHERE chatId = @chatId 
          ORDER BY createdAt DESC
        `);
      
      chatHistory = historyResult.recordset.reverse();
      cacheService.set(cacheKey, chatHistory, { ttl: 300 }); // 5 minutes
    }
    
    let aiResponse: string;
    let tokens: number;
    let dataResult: any = null;
    let queryInfo: any = null;

    // Check if this should use data agent or regular AI
    const shouldUseDataAgent = useDataAgent || containsDataKeywords(message);
    
    if (shouldUseDataAgent && datasetId) {
      try {
        // Use AI Data Service for data-related queries
        const dataResponse = await aiDataService.processDataQuestion({
          question: fullMessage,
          userId,
          datasetId,
          workspaceId
        });
        
        aiResponse = dataResponse.answer;
        tokens = dataResponse.tokens;
        dataResult = dataResponse.data;
        queryInfo = {
          query: dataResponse.query,
          queryType: dataResponse.queryType
        };
      } catch (dataError) {
        logger.warn('Data agent failed, falling back to regular AI:', dataError);
        const fallbackResponse = await getRegularAIResponse(chatHistory, openAIService);
        aiResponse = fallbackResponse.content;
        tokens = fallbackResponse.tokens;
      }
    } else {
      // If we have a workspace context, build a file-based retrieval QA prompt
      let wsIdForQA: string | null = null;
      if (workspaceId) {
        wsIdForQA = workspaceId;
      } else {
        const wsRes = await pool.request()
          .input('chatId', sql.NVarChar, currentChatId)
          .query('SELECT workspaceId FROM Chats WHERE id = @chatId');
        wsIdForQA = wsRes.recordset[0]?.workspaceId || null;
      }

      if (wsIdForQA) {
        try {
          // Derive container name using same convention as uploads
          const wsInfo = await pool.request()
            .input('id', sql.NVarChar, wsIdForQA)
            .query('SELECT id, name FROM Workspaces WHERE id = @id');
          const wsRow = wsInfo.recordset[0];
          const sanitizedName = (wsRow?.name || 'workspace').replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
          const shortName = sanitizedName.substring(0, 20);
          const shortId = String(wsIdForQA).substring(0, 8);
          const containerName = `ws-${shortName}-${shortId}`;

          // Load recent files for retrieval context
          const filesRes = await pool.request()
            .input('workspaceId', sql.NVarChar, wsIdForQA)
            .query('SELECT TOP 3 fileName, originalName FROM WorkspaceFiles WHERE workspaceId = @workspaceId ORDER BY createdAt DESC');

          let workspaceFileContext = '';
          for (const f of filesRes.recordset) {
            try {
              const content = await fileAnalysisService.extractFileContent(f.fileName, f.originalName, containerName);
              workspaceFileContext += `File: ${f.originalName}\n---\n${content.content}\n\n`;
            } catch (ctxErr) {
              logger.warn('Failed to build file context for workspace QA', { file: f.originalName, err: (ctxErr as Error)?.message });
            }
          }

          // If we have any file context, instruct the model to answer strictly from it
          if (workspaceFileContext.trim().length > 0) {
            const messages: ChatMessage[] = [
              { role: 'system', content: 'You are a retrieval QA assistant. Answer strictly and only from the provided workspace file context. If the answer is not present, respond: "I could not find that in the workspace files."' },
              { role: 'user', content: `Question: ${fullMessage}\n\nWorkspace File Context:\n${workspaceFileContext}` }
            ];
            const resQA = await openAIService.getChatCompletion(messages, { maxTokens: 1000, temperature: 0.2 });
            aiResponse = resQA.content;
            tokens = resQA.tokens;
          } else {
            // Fallback to regular assistant if no files exist
            const regularResponse = await getRegularAIResponse(chatHistory, openAIService);
            aiResponse = regularResponse.content;
            tokens = regularResponse.tokens;
          }
        } catch (qaErr) {
          logger.warn('Workspace file QA failed, falling back to regular AI', qaErr);
          const regularResponse = await getRegularAIResponse(chatHistory, openAIService);
          aiResponse = regularResponse.content;
          tokens = regularResponse.tokens;
        }
      } else {
        // No workspace context; regular assistant
        const regularResponse = await getRegularAIResponse(chatHistory, openAIService);
        aiResponse = regularResponse.content;
        tokens = regularResponse.tokens;
      }
    }

    // Save AI response
    const aiMessageId = uuidv4();
    const aiMessageResult = await pool.request()
      .input('id', sql.NVarChar, aiMessageId)
      .input('chatId', sql.NVarChar, currentChatId)
      .input('userId', sql.NVarChar, userId)
      .input('content', sql.NVarChar, aiResponse)
      .input('role', sql.NVarChar, 'assistant')
      .input('tokens', sql.Int, tokens)
      .query(`
        INSERT INTO Messages (id, chatId, userId, content, role, tokens)
        OUTPUT INSERTED.*
        VALUES (@id, @chatId, @userId, @content, @role, @tokens)
      `);

    const aiMessageData = aiMessageResult.recordset[0];

    // Update chat's last activity
    await pool.request()
      .input('chatId', sql.NVarChar, currentChatId)
      .query('UPDATE Chats SET updatedAt = GETUTCDATE() WHERE id = @chatId');

    // Update cache
    chatHistory.push(
      { content: fullMessage, role: 'user', createdAt: userMessageData.createdAt },
      { content: aiResponse, role: 'assistant', createdAt: aiMessageData.createdAt }
    );
    cacheService.set(cacheKey, chatHistory.slice(-20), { ttl: 300 });

    res.json({
      message: 'Message sent successfully',
      chatId: currentChatId,
      userMessage: {
        id: userMessageId,
        content: message,
        role: 'user',
        timestamp: userMessageData.createdAt
      },
      aiResponse: {
        id: aiMessageId,
        content: aiResponse,
        role: 'assistant',
        timestamp: aiMessageData.createdAt
      },
      ...(dataResult && { dataResult }),
      ...(queryInfo && { queryInfo })
    });

    logger.info(`Message processed for chat: ${currentChatId}`);

    // Audit log Q&A interaction scoped to workspace
    try {
      let wsIdForAudit: string | null = null;
      if (workspaceId) {
        wsIdForAudit = workspaceId;
      } else {
        const wsRes = await pool.request()
          .input('chatId', sql.NVarChar, currentChatId)
          .query('SELECT workspaceId FROM Chats WHERE id = @chatId');
        wsIdForAudit = wsRes.recordset[0]?.workspaceId || null;
      }
      await logAudit(pool, { userId, workspaceId: wsIdForAudit, action: 'workspace.qa', details: `msg:${message.substring(0, 80)}` });
    } catch (auditErr) {
      logger.warn('Audit log (workspace.qa) failed:', auditErr);
    }
  } catch (error) {
    logger.error('Send message error:', error);
    res.status(500).json({
      error: 'Failed to process message',
      message: 'Please try again later'
    });
  }
});

// Helper function to get regular AI response
async function getRegularAIResponse(chatHistory: any[], openAIService: any) {
  const messages = [
    {
      role: 'system',
      content: openAIService.getSystemPrompt()
    },
    ...chatHistory.slice(-10).map((msg: any) => ({
      role: msg.role,
      content: msg.content
    }))
  ];

  return await openAIService.getChatCompletion(messages, {
    maxTokens: 1000,
    temperature: 0.7
  });
}

// Get messages for a chat
router.get('/:chatId/messages', validate(schemas.chatIdParam), validate(schemas.pagination), async (req, res) => {
  try {
    const { chatId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const userId = req.user.userId;
    
    const pool = await dbManager.getPool();
    const offset = (Number(page) - 1) * Number(limit);
    
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
    
    const result = await pool.request()
      .input('chatId', sql.NVarChar, chatId)
      .input('limit', sql.Int, Number(limit))
      .input('offset', sql.Int, offset)
      .query(`
        SELECT 
          m.*,
          (SELECT COUNT(*) FROM MessageActions WHERE messageId = m.id AND actionType = 'like') as likeCount,
          (SELECT COUNT(*) FROM MessageActions WHERE messageId = m.id AND actionType = 'bookmark') as bookmarkCount
        FROM Messages m
        WHERE m.chatId = @chatId
        ORDER BY m.createdAt ASC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `);
    
    const countResult = await pool.request()
      .input('chatId', sql.NVarChar, chatId)
      .query('SELECT COUNT(*) as total FROM Messages WHERE chatId = @chatId');
    
    const total = countResult.recordset[0].total;

    res.json({
      message: 'Messages retrieved successfully',
      messages: result.recordset,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    logger.error('Get messages error:', error);
    res.status(500).json({
      error: 'Failed to retrieve messages'
    });
  }
});

// Delete chat
router.delete('/:chatId', validate(schemas.chatIdParam), async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user.userId;
    
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
    
    // Soft delete - mark as archived
    await pool.request()
      .input('chatId', sql.NVarChar, chatId)
      .query('UPDATE Chats SET isArchived = 1 WHERE id = @chatId');
    
    // Clear cache
    cacheService.delete(`chat_history:${chatId}`);
    
    res.json({
      message: 'Chat deleted successfully'
    });

    logger.info(`Chat deleted: ${chatId} by user: ${userId}`);
  } catch (error) {
    logger.error('Delete chat error:', error);
    res.status(500).json({
      error: 'Failed to delete chat'
    });
  }
});

export { router as chatRoutes };