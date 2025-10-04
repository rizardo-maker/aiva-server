import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { DatabaseManager } from '../config/database';
import { logger } from '../utils/logger';
import sql from 'mssql';

const router = express.Router();
const dbManager = DatabaseManager.getInstance();

// Database helper functions
async function getUserChatHistory(userId: string, limit: number = 50) {
  try {
    const pool = await dbManager.getPool();
    const result = await pool.request()
      .input('userId', sql.NVarChar, userId)
      .input('limit', sql.Int, limit)
      .query(`
        SELECT TOP (@limit) c.*, 
               (SELECT TOP 1 content FROM Messages m WHERE m.chatId = c.id ORDER BY m.createdAt DESC) as lastMessage
        FROM Chats c
        WHERE c.userId = @userId AND c.isArchived = 0
        ORDER BY c.lastMessageAt DESC, c.updatedAt DESC
      `);
    
    return result.recordset.map(chat => ({
      id: chat.id,
      title: chat.title,
      description: chat.description,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt || chat.createdAt,
      messageCount: chat.messageCount || 0,
      lastMessage: chat.lastMessage || 'No messages yet',
      workspace: {
        name: 'General',
        color: '#3B82F6'
      }
    }));
  } catch (error) {
    logger.error('Error getting user chat history:', error);
    throw error;
  }
}

async function getChatsByUserId(userId: string) {
  try {
    const pool = await dbManager.getPool();
    const result = await pool.request()
      .input('userId', sql.NVarChar, userId)
      .query('SELECT * FROM Chats WHERE userId = @userId ORDER BY createdAt DESC');
    
    return result.recordset;
  } catch (error) {
    logger.error('Error getting chats:', error);
    throw error;
  }
}

async function getMessagesByChatId(chatId: string) {
  try {
    const pool = await dbManager.getPool();
    const result = await pool.request()
      .input('chatId', sql.NVarChar, chatId)
      .query('SELECT * FROM Messages WHERE chatId = @chatId ORDER BY createdAt ASC');
    
    return result.recordset.map(message => ({
      ...message,
      metadata: message.metadata ? JSON.parse(message.metadata) : null
    }));
  } catch (error) {
    logger.error('Error getting messages:', error);
    throw error;
  }
}

// Apply authentication to all history routes
router.use(authenticateToken);

// Get user chat history
router.get('/', async (req, res) => {
  try {
    const userId = req.user.userId;
    const limit = parseInt(req.query.limit as string) || 50;
    
    const chatHistory = await getUserChatHistory(userId, limit);

    res.json({
      message: 'Chat history retrieved successfully',
      chatHistory
    });
  } catch (error) {
    logger.error('Get chat history error:', error);
    res.status(500).json({
      error: 'Failed to retrieve chat history'
    });
  }
});

// Get specific chat details with messages
router.get('/:chatId', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { chatId } = req.params;

    // First verify that the chat belongs to the user
    const userChats = await getChatsByUserId(userId);
    const chat = userChats.find(c => c.id === chatId);
    
    if (!chat) {
      return res.status(404).json({
        error: 'Chat not found',
        message: 'The requested chat does not exist or you do not have access to it'
      });
    }

    // Get all messages for this chat
    const messages = await getMessagesByChatId(chatId);

    res.json({
      message: 'Chat details retrieved successfully',
      chat: {
        ...chat,
        messages
      }
    });
  } catch (error) {
    logger.error('Get chat details error:', error);
    res.status(500).json({
      error: 'Failed to retrieve chat details'
    });
  }
});

export { router as historyRoutes };