import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { authenticateToken } from '../middleware/auth';
import { blobServiceClient, createFile, getFileById, getFilesByUserId, deleteFileRecord } from '../services/azure';
import { logger } from '../utils/logger';

const router = express.Router();

// Apply authentication to all file routes
router.use(authenticateToken);

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
      'text/plain'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'));
    }
  }
});

// Upload file endpoint
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No file provided'
      });
    }

    const userId = req.user.userId;
    const file = req.file;
    const fileId = uuidv4();
    const fileName = `${userId}/${fileId}-${file.originalname}`;
    
    let fileUrl = '';
    
    // Check if we're using mock storage
    const isMockStorage = !process.env.AZURE_STORAGE_ACCOUNT_NAME || process.env.MOCK_STORAGE === 'true';
    
    if (!isMockStorage) {
      const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME || 'aiva-files';
      const containerClient = blobServiceClient.getContainerClient(containerName);
      const blockBlobClient = containerClient.getBlockBlobClient(fileName);

      // Upload file to Azure Blob Storage
      await blockBlobClient.uploadData(file.buffer, {
        blobHTTPHeaders: {
          blobContentType: file.mimetype
        },
        metadata: {
          userId,
          originalName: file.originalname,
          uploadDate: new Date().toISOString()
        }
      });

      fileUrl = blockBlobClient.url;
    } else {
      // For mock storage, generate a mock URL
      fileUrl = `https://mockstorage.example.com/${fileName}`;
    }

    // Store file metadata in database
    const fileData = {
      id: fileId,
      originalName: file.originalname,
      fileName: fileName,
      mimeType: file.mimetype,
      size: file.size,
      url: fileUrl,
      userId: userId,
      chatId: req.body.chatId || null,
      messageId: req.body.messageId || null
    };

    const fileRecord = await createFile(fileData);

    res.json({
      message: 'File uploaded successfully',
      file: fileRecord
    });

    logger.info(`File uploaded: ${fileName} by user: ${userId}`);
  } catch (error) {
    logger.error('File upload error:', error);
    res.status(500).json({
      error: 'Failed to upload file',
      message: 'Please try again later'
    });
  }
});

// Get user's files
router.get('/', async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Get files from database
    const files = await getFilesByUserId(userId);

    res.json({
      message: 'Files retrieved successfully',
      files
    });
  } catch (error) {
    logger.error('Get files error:', error);
    res.status(500).json({
      error: 'Failed to retrieve files'
    });
  }
});

// Delete file
router.delete('/:fileId', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { fileId } = req.params;
    
    // Get file from database
    const file = await getFileById(fileId);
    
    if (!file) {
      return res.status(404).json({
        error: 'File not found'
      });
    }
    
    // Check if user owns the file
    if (file.userId !== userId) {
      return res.status(403).json({
        error: 'Access denied'
      });
    }
    
    // Check if we're using mock storage
    const isMockStorage = !process.env.AZURE_STORAGE_ACCOUNT_NAME || process.env.MOCK_STORAGE === 'true';
    
    if (!isMockStorage) {
      const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME || 'aiva-files';
      const containerClient = blobServiceClient.getContainerClient(containerName);
      const blobClient = containerClient.getBlobClient(file.fileName);

      // Delete the blob from storage
      await blobClient.delete();
    }

    // Delete file record from database
    await deleteFileRecord(fileId);

    res.json({
      message: 'File deleted successfully',
      fileId
    });

    logger.info(`File deleted: ${file.fileName} by user: ${userId}`);
  } catch (error) {
    logger.error('Delete file error:', error);
    res.status(500).json({
      error: 'Failed to delete file'
    });
  }
});

// Download file
router.get('/download/:fileId', async (req, res) => {
  try {
    const userId = req.user.userId;
    const { fileId } = req.params;
    
    // Get file from database
    const file = await getFileById(fileId);
    
    if (!file) {
      return res.status(404).json({
        error: 'File not found'
      });
    }
    
    // Check if user owns the file
    if (file.userId !== userId) {
      return res.status(403).json({
        error: 'Access denied'
      });
    }
    
    // Check if we're using mock storage
    const isMockStorage = !process.env.AZURE_STORAGE_ACCOUNT_NAME || process.env.MOCK_STORAGE === 'true';
    
    if (isMockStorage) {
      // For mock storage, return a mock file
      res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${file.originalName}"`);
      res.setHeader('Content-Length', file.size || 0);
      return res.send(`Mock file content for ${file.originalName}`);
    }
    
    const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME || 'aiva-files';
    const containerClient = blobServiceClient.getContainerClient(containerName);
    const blobClient = containerClient.getBlobClient(file.fileName);

    // Check if blob exists
    const exists = await blobClient.exists();
    if (!exists) {
      return res.status(404).json({
        error: 'File not found in storage'
      });
    }

    // Get blob properties
    const properties = await blobClient.getProperties();
    
    // Set response headers
    res.setHeader('Content-Type', properties.contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${file.originalName}"`);
    res.setHeader('Content-Length', properties.contentLength || 0);

    // Stream the blob to response
    const downloadResponse = await blobClient.download();
    if (downloadResponse.readableStreamBody) {
      downloadResponse.readableStreamBody.pipe(res);
    } else {
      throw new Error('Failed to get file stream');
    }

    logger.info(`File downloaded: ${file.fileName} by user: ${userId}`);
  } catch (error) {
    logger.error('Download file error:', error);
    res.status(500).json({
      error: 'Failed to download file'
    });
  }
});

export { router as fileRoutes };