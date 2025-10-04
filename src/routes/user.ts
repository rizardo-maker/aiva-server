import express from 'express';
import Joi from 'joi';
import { authenticateToken } from '../middleware/auth';
import { getUserById, updateUser } from '../services/azure';
import { logger } from '../utils/logger';

const router = express.Router();

// Apply authentication to all user routes
router.use(authenticateToken);

// Validation schemas
const updateProfileSchema = Joi.object({
  firstName: Joi.string().min(2).max(50),
  lastName: Joi.string().min(2).max(50),
  preferences: Joi.object({
    theme: Joi.string().valid('light', 'dark'),
    language: Joi.string().min(2).max(5),
    notifications: Joi.boolean()
  }).optional()
});

// Get user profile
router.get('/profile', async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await getUserById(userId);

    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    // Remove sensitive information
    const { password, ...userProfile } = user;

    res.json({
      message: 'Profile retrieved successfully',
      user: userProfile
    });
  } catch (error) {
    logger.error('Get profile error:', error);
    res.status(500).json({
      error: 'Failed to retrieve profile'
    });
  }
});

// Update user profile
router.put('/profile', async (req, res) => {
  try {
    const { error, value } = updateProfileSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details[0].message
      });
    }

    const userId = req.user.userId;
    const updates = {
      ...value,
      updatedAt: new Date().toISOString()
    };

    // Get current user data
    const currentUser = await getUserById(userId);
    if (!currentUser) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    // Merge updates with current data
    const updatedUserData = {
      ...currentUser,
      ...updates
    };

    const updatedUser = await updateUser(userId, updatedUserData);

    // Remove sensitive information
    const { password, ...userProfile } = updatedUser;

    res.json({
      message: 'Profile updated successfully',
      user: userProfile
    });

    logger.info(`Profile updated for user: ${userId}`);
  } catch (error) {
    logger.error('Update profile error:', error);
    res.status(500).json({
      error: 'Failed to update profile'
    });
  }
});

// Get user statistics
router.get('/stats', async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // This would typically involve querying multiple containers
    // For now, return mock statistics
    const stats = {
      totalChats: 0,
      totalMessages: 0,
      averageMessagesPerChat: 0,
      mostActiveDay: null,
      joinedDate: new Date().toISOString(),
      lastActivity: new Date().toISOString()
    };

    res.json({
      message: 'Statistics retrieved successfully',
      stats
    });
  } catch (error) {
    logger.error('Get stats error:', error);
    res.status(500).json({
      error: 'Failed to retrieve statistics'
    });
  }
});

// Delete user account
router.delete('/account', async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // In a production environment, you would:
    // 1. Soft delete the user account
    // 2. Anonymize or delete associated data
    // 3. Handle data retention policies
    // 4. Send confirmation emails
    
    // For now, just log the request
    logger.info(`Account deletion requested for user: ${userId}`);
    
    res.json({
      message: 'Account deletion request received',
      note: 'Your account will be processed for deletion within 24 hours'
    });
  } catch (error) {
    logger.error('Delete account error:', error);
    res.status(500).json({
      error: 'Failed to process account deletion'
    });
  }
});

export { router as userRoutes };