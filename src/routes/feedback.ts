import express from 'express';
import { DatabaseManager } from '../config/database';
import { logger } from '../utils/logger';
import { authenticateToken } from '../middleware/auth';
import sql from 'mssql';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();
const dbManager = DatabaseManager.getInstance();

// Apply authentication to all feedback routes
router.use(authenticateToken);

// Create feedback
router.post('/', async (req, res) => {
  try {
    const { subject, message, category, priority = 'medium' } = req.body;
    const userId = req.user.userId;

    if (!subject || !message || !category) {
      return res.status(400).json({
        error: 'Subject, message, and category are required'
      });
    }

    const validCategories = ['bug', 'feature', 'improvement', 'general', 'complaint', 'compliment'];
    const validPriorities = ['low', 'medium', 'high', 'critical'];

    if (!validCategories.includes(category)) {
      return res.status(400).json({
        error: 'Invalid category'
      });
    }

    if (!validPriorities.includes(priority)) {
      return res.status(400).json({
        error: 'Invalid priority'
      });
    }

    const pool = await dbManager.getPool();
    const feedbackId = uuidv4();

    await pool.request()
      .input('id', sql.NVarChar, feedbackId)
      .input('userId', sql.NVarChar, userId)
      .input('subject', sql.NVarChar, subject)
      .input('message', sql.NVarChar, message)
      .input('category', sql.NVarChar, category)
      .input('priority', sql.NVarChar, priority)
      .query(`
        INSERT INTO Feedback (id, userId, subject, message, category, priority)
        VALUES (@id, @userId, @subject, @message, @category, @priority)
      `);

    logger.info('Feedback created:', { feedbackId, userId, category });

    res.status(201).json({
      message: 'Feedback submitted successfully',
      feedbackId
    });
  } catch (error) {
    logger.error('Create feedback error:', error);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

// Get user's feedback
router.get('/my-feedback', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 10 } = req.query;
    const pool = await dbManager.getPool();
    const offset = (Number(page) - 1) * Number(limit);

    const result = await pool.request()
      .input('userId', sql.NVarChar, userId)
      .input('limit', sql.Int, Number(limit))
      .input('offset', sql.Int, offset)
      .query(`
        SELECT 
          f.*,
          a.firstName + ' ' + a.lastName as adminName
        FROM Feedback f
        LEFT JOIN Users a ON f.adminId = a.id
        WHERE f.userId = @userId
        ORDER BY f.createdAt DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `);

    const countResult = await pool.request()
      .input('userId', sql.NVarChar, userId)
      .query('SELECT COUNT(*) as total FROM Feedback WHERE userId = @userId');

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
    logger.error('Get user feedback error:', error);
    res.status(500).json({ error: 'Failed to retrieve feedback' });
  }
});

export { router as feedbackRoutes };