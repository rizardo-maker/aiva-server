import express from 'express';
import { authenticateToken } from '../middleware/auth';
import { DatabaseManager } from '../config/database';
import { logger } from '../utils/logger';
import sql from 'mssql';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();
const dbManager = DatabaseManager.getInstance();

// Database helper functions
async function getUserLikedMessages(userId: string) {
  try {
    const pool = await dbManager.getPool();
    const result = await pool.request()
      .input('userId', sql.NVarChar, userId)
      .query(`
        SELECT ma.*, m.content as messageContent, m.role as messageRole, m.createdAt as messageCreatedAt,
               m.chatId as chatId, c.title as chatTitle
        FROM MessageActions ma
        LEFT JOIN Messages m ON ma.messageId = m.id
        LEFT JOIN Chats c ON m.chatId = c.id
        WHERE ma.userId = @userId AND ma.actionType = 'like'
        ORDER BY ma.createdAt DESC
      `);
    
    // Debug logging for liked messages
    console.log('Raw SQL result for liked messages:', JSON.stringify(result.recordset, null, 2));
    
    return result.recordset.map(record => {
      console.log('Processing liked message record:', {
        messageId: record.messageId,
        messageContent: record.messageContent,
        chatId: record.chatId,
        role: record.messageRole,
        createdAt: record.messageCreatedAt,
        chatTitle: record.chatTitle
      });
      
      return {
        id: record.messageId,
        content: record.messageContent || 'Message content not found',
        chatId: record.chatId,
        role: record.messageRole,
        createdAt: record.messageCreatedAt,
        chat: {
          title: record.chatTitle || 'Unknown Chat',
          workspace: {
            name: 'General'
          }
        }
      };
    });
  } catch (error) {
    logger.error('Error getting user liked messages:', error);
    throw error;
  }
}

async function getUserDislikedMessages(userId: string) {
  try {
    const pool = await dbManager.getPool();
    const result = await pool.request()
      .input('userId', sql.NVarChar, userId)
      .query(`
        SELECT ma.*, m.content as messageContent, m.role as messageRole, m.createdAt as messageCreatedAt,
               m.chatId as chatId, c.title as chatTitle
        FROM MessageActions ma
        LEFT JOIN Messages m ON ma.messageId = m.id
        LEFT JOIN Chats c ON m.chatId = c.id
        WHERE ma.userId = @userId AND ma.actionType = 'dislike'
        ORDER BY ma.createdAt DESC
      `);
    
    return result.recordset.map(record => ({
      id: record.messageId,
      content: record.messageContent,
      chatId: record.chatId,
      role: record.messageRole,
      createdAt: record.messageCreatedAt,
      chat: {
        title: record.chatTitle,
        workspace: {
          name: 'General'
        }
      }
    }));
  } catch (error) {
    logger.error('Error getting user disliked messages:', error);
    throw error;
  }
}

async function addMessageAction(userId: string, messageId: string, actionType: string) {
  try {
    const pool = await dbManager.getPool();
    const actionId = uuidv4();
    
    // First, remove any existing action of this type for this message/user
    await pool.request()
      .input('messageId', sql.NVarChar, messageId)
      .input('userId', sql.NVarChar, userId)
      .input('actionType', sql.NVarChar, actionType)
      .query(`
        DELETE FROM MessageActions 
        WHERE messageId = @messageId AND userId = @userId AND actionType = @actionType
      `);
    
    // Then add the new action
    await pool.request()
      .input('id', sql.NVarChar, actionId)
      .input('messageId', sql.NVarChar, messageId)
      .input('userId', sql.NVarChar, userId)
      .input('actionType', sql.NVarChar, actionType)
      .query(`
        INSERT INTO MessageActions (id, messageId, userId, actionType)
        VALUES (@id, @messageId, @userId, @actionType)
      `);
    
    logger.info(`Message action added: ${actionType} for message: ${messageId} user: ${userId}`);
  } catch (error) {
    logger.error('Error adding message action:', error);
    throw error;
  }
}

async function removeMessageAction(userId: string, messageId: string, actionType: string) {
  try {
    const pool = await dbManager.getPool();
    await pool.request()
      .input('messageId', sql.NVarChar, messageId)
      .input('userId', sql.NVarChar, userId)
      .input('actionType', sql.NVarChar, actionType)
      .query(`
        DELETE FROM MessageActions 
        WHERE messageId = @messageId AND userId = @userId AND actionType = @actionType
      `);
    
    logger.info(`Message action removed: ${actionType} for message: ${messageId} user: ${userId}`);
  } catch (error) {
    logger.error('Error removing message action:', error);
    throw error;
  }
}

// Apply authentication to all message action routes
router.use(authenticateToken);

// Get user liked messages
router.get('/liked', async (req, res) => {
  try {
    const userId = req.user.userId;
    const likedMessages = await getUserLikedMessages(userId);

    // Debug logging
    console.log('Liked messages query result:', JSON.stringify(likedMessages, null, 2));

    res.json({
      message: 'Liked messages retrieved successfully',
      likedMessages
    });
  } catch (error) {
    logger.error('Get liked messages error:', error);
    res.status(500).json({
      error: 'Failed to retrieve liked messages'
    });
  }
});

// Get user disliked messages
router.get('/disliked', async (req, res) => {
  try {
    const userId = req.user.userId;
    const dislikedMessages = await getUserDislikedMessages(userId);

    res.json({
      message: 'Disliked messages retrieved successfully',
      dislikedMessages
    });
  } catch (error) {
    logger.error('Get disliked messages error:', error);
    res.status(500).json({
      error: 'Failed to retrieve disliked messages'
    });
  }
});

// Add message action (like, dislike, star, bookmark)
router.post('/:messageId/:actionType', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { messageId, actionType } = req.params;

    // Validate action type
    const validActions = ['like', 'dislike', 'star', 'bookmark'];
    if (!validActions.includes(actionType)) {
      return res.status(400).json({
        error: 'Invalid action type',
        message: 'Action type must be one of: like, dislike, star, bookmark'
      });
    }

    // If liking, remove any existing dislike (and vice versa)
    if (actionType === 'like') {
      await removeMessageAction(userId, messageId, 'dislike');
    } else if (actionType === 'dislike') {
      await removeMessageAction(userId, messageId, 'like');
    }

    await addMessageAction(userId, messageId, actionType);

    res.status(201).json({
      message: `Message ${actionType} added successfully`
    });

    logger.info(`Message action added: ${actionType} for user: ${userId}, message: ${messageId}`);
  } catch (error) {
    logger.error('Add message action error:', error);
    res.status(500).json({
      error: 'Failed to add message action'
    });
  }
});

// Remove message action
router.delete('/:messageId/:actionType', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { messageId, actionType } = req.params;

    // Validate action type
    const validActions = ['like', 'dislike', 'star', 'bookmark'];
    if (!validActions.includes(actionType)) {
      return res.status(400).json({
        error: 'Invalid action type',
        message: 'Action type must be one of: like, dislike, star, bookmark'
      });
    }

    await removeMessageAction(userId, messageId, actionType);

    res.json({
      message: `Message ${actionType} removed successfully`
    });

    logger.info(`Message action removed: ${actionType} for user: ${userId}, message: ${messageId}`);
  } catch (error) {
    logger.error('Remove message action error:', error);
    res.status(500).json({
      error: 'Failed to remove message action'
    });
  }
});

export { router as messageActionRoutes };