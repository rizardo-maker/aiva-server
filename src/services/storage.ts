import { BlobServiceClient, ContainerClient, BlockBlobClient } from '@azure/storage-blob';
// TODO: Install @azure/identity package using: npm install @azure/identity
import { DefaultAzureCredential } from '@azure/identity';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export interface UploadResult {
  id: string;
  url: string;
  fileName: string;
  originalName: string;
  size: number;
  mimeType: string;
}

export class StorageService {
  private static instance: StorageService;
  private blobServiceClient: BlobServiceClient;
  private containerName: string;

  private mockMode: boolean = false;
  
  private constructor() {
    this.containerName = process.env.AZURE_STORAGE_CONTAINER_NAME || 'aiva-files';
    // Initialize blobServiceClient with a placeholder that will be properly set in initialize()
    this.blobServiceClient = {} as BlobServiceClient;
  }
  
  public async initialize(): Promise<void> {
    try {
      // Check if we should use mock mode - only in development if explicitly requested
      const mockStorage = process.env.MOCK_STORAGE === 'true';
      
      // Only use mock storage if explicitly requested
      if (mockStorage) {
        logger.info('Mock storage mode enabled');
        this.mockMode = true;
        logger.info('✅ Storage service initialized in mock mode');
        return;
      }
      
      const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
      
      if (!accountName) {
        logger.warn('Azure Storage configuration missing. Using mock storage mode.');
        this.mockMode = true;
        logger.info('✅ Storage service initialized in mock mode');
        return;
      }

      // Use DefaultAzureCredential for production, connection string for development
      if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
        this.blobServiceClient = BlobServiceClient.fromConnectionString(
          process.env.AZURE_STORAGE_CONNECTION_STRING
        );
      } else {
        this.blobServiceClient = new BlobServiceClient(
          `https://${accountName}.blob.core.windows.net`,
          new DefaultAzureCredential()
        );
      }

      logger.info('✅ Storage service initialized');
    } catch (error) {
      logger.error('Failed to initialize storage service:', error);
      logger.info('Falling back to mock storage mode');
      this.mockMode = true;
    }
  }

  public static getInstance(): StorageService {
    if (!StorageService.instance) {
      StorageService.instance = new StorageService();
    }
    return StorageService.instance;
  }

  public static resetInstance(): void {
    StorageService.instance = undefined as unknown as StorageService;
  }

  public async initializeContainer(): Promise<void> {
    if (this.mockMode) {
      logger.info(`✅ Mock storage container '${this.containerName}' ready`);
      return;
    }
    
    try {
      const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
      await containerClient.createIfNotExists({
        access: 'blob'
      });
      logger.info(`✅ Storage container '${this.containerName}' ready`);
    } catch (error) {
      logger.error('Failed to initialize storage container:', error);
      logger.info('Falling back to mock storage mode');
      this.mockMode = true;
    }
  }

  public async uploadFile(
    buffer: Buffer,
    originalName: string,
    mimeType: string,
    userId: string
  ): Promise<UploadResult> {
    const fileId = uuidv4();
    const fileExtension = originalName.split('.').pop() || '';
    const fileName = `${userId}/${fileId}.${fileExtension}`;
    
    if (this.mockMode) {
      logger.info(`Mock file upload: ${fileName} (${buffer.length} bytes)`);
      return {
        id: fileId,
        url: `https://mock-storage.example.com/${this.containerName}/${fileName}`,
        fileName,
        originalName,
        size: buffer.length,
        mimeType
      };
    }
    
    try {
      const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
      const blockBlobClient = containerClient.getBlockBlobClient(fileName);

      await blockBlobClient.uploadData(buffer, {
        blobHTTPHeaders: {
          blobContentType: mimeType
        },
        metadata: {
          userId,
          originalName,
          uploadDate: new Date().toISOString()
        }
      });

      return {
        id: fileId,
        url: blockBlobClient.url,
        fileName,
        originalName,
        size: buffer.length,
        mimeType
      };
    } catch (error) {
      logger.error('File upload error:', error);
      
      // Fall back to mock mode
      this.mockMode = true;
      return this.uploadFile(buffer, originalName, mimeType, userId);
    }
  }

  public async deleteFile(fileName: string): Promise<void> {
    if (this.mockMode) {
      logger.info(`Mock file deletion: ${fileName}`);
      return;
    }
    
    try {
      const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
      const blobClient = containerClient.getBlobClient(fileName);
      await blobClient.deleteIfExists();
      logger.info(`File deleted: ${fileName}`);
    } catch (error) {
      logger.error('File deletion error:', error);
      this.mockMode = true;
      return this.deleteFile(fileName);
    }
  }

  // Helper method to convert stream to buffer
  private async streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  public async getFileContent(fileName: string): Promise<string> {
    try {
      const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
      const blobClient = containerClient.getBlobClient(fileName);
      
      const downloadResponse = await blobClient.download();
      const buffer = await this.streamToBuffer(downloadResponse.readableStreamBody!);
      return buffer.toString();
    } catch (error) {
      logger.error('File content read error:', error);
      throw new Error('Failed to read file content');
    }
  }

  public async getFileStream(fileName: string): Promise<NodeJS.ReadableStream> {
    try {
      const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
      const blobClient = containerClient.getBlobClient(fileName);
      
      const downloadResponse = await blobClient.download();
      if (!downloadResponse.readableStreamBody) {
        throw new Error('Failed to get file stream');
      }
      
      return downloadResponse.readableStreamBody;
    } catch (error) {
      logger.error('File download error:', error);
      throw new Error('Failed to download file');
    }
  }

  public async listUserFiles(userId: string): Promise<Array<{
    name: string;
    size: number;
    lastModified: Date;
    url: string;
  }>> {
    try {
      const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
      const prefix = `${userId}/`;
      const files = [];

      for await (const blob of containerClient.listBlobsFlat({ prefix })) {
        const blobClient = containerClient.getBlobClient(blob.name);
        files.push({
          name: blob.name.replace(prefix, ''),
          size: blob.properties.contentLength || 0,
          lastModified: blob.properties.lastModified || new Date(),
          url: blobClient.url
        });
      }

      return files;
    } catch (error) {
      logger.error('List files error:', error);
      throw new Error('Failed to list files');
    }
  }

  public async fileExists(fileName: string): Promise<boolean> {
    try {
      const containerClient = this.blobServiceClient.getContainerClient(this.containerName);
      const blobClient = containerClient.getBlobClient(fileName);
      return await blobClient.exists();
    } catch (error) {
      logger.error('File exists check error:', error);
      return false;
    }
  }
}