import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import { blobServiceClient } from './azure';
import { logger } from '../utils/logger';

export class WorkspaceStorageService {
  private static instance: WorkspaceStorageService;

  private constructor() {}

  public static getInstance(): WorkspaceStorageService {
    if (!WorkspaceStorageService.instance) {
      WorkspaceStorageService.instance = new WorkspaceStorageService();
    }
    return WorkspaceStorageService.instance;
  }

  /**
   * Creates a blob storage container for a workspace
   * @param workspaceId - The unique ID of the workspace
   * @param workspaceName - The name of the workspace
   * @returns The container name if successful, null otherwise
   */
  public async createWorkspaceContainer(workspaceId: string, workspaceName: string): Promise<string | null> {
    try {
      if (!blobServiceClient) {
        logger.warn('Blob service client not initialized, skipping container creation');
        return null;
      }

      // Create a container with the workspace name and ID for better identification
      // Format: ws-{shortName}-{shortId} (Azure container names max 63 chars)
      const sanitizedWorkspaceName = workspaceName.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
      const shortWorkspaceName = sanitizedWorkspaceName.substring(0, 20); // Limit to 20 chars
      const shortWorkspaceId = workspaceId.substring(0, 8); // Use first 8 chars of UUID
      const containerName = `ws-${shortWorkspaceName}-${shortWorkspaceId}`;
      const containerClient = blobServiceClient.getContainerClient(containerName);
      
      logger.info(`Creating blob storage container: ${containerName} for workspace: ${workspaceName}`);
      
      // Create container if it doesn't exist (handle public access restrictions)
      try {
        await containerClient.createIfNotExists({
          access: 'container'
        });
      } catch (containerError: any) {
        if (containerError.code === 'PublicAccessNotPermitted') {
          logger.info(`Public access not permitted, creating private container: ${containerName}`);
          await containerClient.createIfNotExists(); // Create without public access
        } else {
          throw containerError;
        }
      }
      
      // Verify container was created
      const exists = await containerClient.exists();
      if (exists) {
        logger.info(`Successfully created and verified blob storage container: ${containerName}`);
        return containerName;
      } else {
        logger.warn(`Failed to verify blob storage container creation: ${containerName}`);
        return null;
      }
    } catch (error) {
      logger.error(`Failed to create blob storage container for workspace ${workspaceName} (${workspaceId}):`, error);
      return null;
    }
  }

  /**
   * Deletes a blob storage container for a workspace
   * @param workspaceId - The unique ID of the workspace
   * @param workspaceName - The name of the workspace (optional, for container name generation)
   * @returns True if successful, false otherwise
   */
  public async deleteWorkspaceContainer(workspaceId: string, workspaceName?: string): Promise<boolean> {
    try {
      if (!blobServiceClient) {
        logger.warn('Blob service client not initialized, skipping container deletion');
        return false;
      }

      // Use the same naming convention as createWorkspaceContainer
      let containerName = `ws-${workspaceId.substring(0, 8)}`;
      if (workspaceName) {
        const sanitizedWorkspaceName = workspaceName.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
        const shortWorkspaceName = sanitizedWorkspaceName.substring(0, 20);
        const shortWorkspaceId = workspaceId.substring(0, 8);
        containerName = `ws-${shortWorkspaceName}-${shortWorkspaceId}`;
      }
      
      const containerClient = blobServiceClient.getContainerClient(containerName);
      
      logger.info(`Deleting blob storage container: ${containerName}`);
      
      // Delete container if it exists
      const deleteResponse = await containerClient.deleteIfExists();
      
      if (deleteResponse.succeeded) {
        logger.info(`Successfully deleted blob storage container: ${containerName}`);
        return true;
      } else {
        // Try fallback container name if the first one didn't exist
        if (!workspaceName) {
          logger.info(`Blob storage container ${containerName} did not exist or was already deleted`);
          return true;
        } else {
          // Try with just workspace ID as fallback (old naming convention)
          const fallbackContainerName = `ws-${workspaceId.substring(0, 8)}`;
          const fallbackContainerClient = blobServiceClient.getContainerClient(fallbackContainerName);
          const fallbackDeleteResponse = await fallbackContainerClient.deleteIfExists();
          
          if (fallbackDeleteResponse.succeeded) {
            logger.info(`Successfully deleted blob storage container (fallback): ${fallbackContainerName}`);
            return true;
          } else {
            logger.info(`Blob storage container ${containerName} and fallback ${fallbackContainerName} did not exist or were already deleted`);
            return true;
          }
        }
      }
    } catch (error) {
      logger.error(`Failed to delete blob storage container for workspace ${workspaceId}:`, error);
      return false;
    }
  }

  /**
   * Checks if a blob storage container exists for a workspace
   * @param workspaceId - The unique ID of the workspace
   * @param workspaceName - The name of the workspace (optional, for container name generation)
   * @returns True if container exists, false otherwise
   */
  public async containerExists(workspaceId: string, workspaceName?: string): Promise<boolean> {
    try {
      if (!blobServiceClient) {
        logger.warn('Blob service client not initialized');
        return false;
      }

      // Use the same naming convention as createWorkspaceContainer
      let containerName = `ws-${workspaceId.substring(0, 8)}`;
      if (workspaceName) {
        const sanitizedWorkspaceName = workspaceName.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
        const shortWorkspaceName = sanitizedWorkspaceName.substring(0, 20);
        const shortWorkspaceId = workspaceId.substring(0, 8);
        containerName = `ws-${shortWorkspaceName}-${shortWorkspaceId}`;
      }
      
      const containerClient = blobServiceClient.getContainerClient(containerName);
      
      return await containerClient.exists();
    } catch (error) {
      logger.error(`Failed to check if container exists for workspace ${workspaceId}:`, error);
      return false;
    }
  }

  /**
   * Lists all blobs in a workspace container
   * @param workspaceId - The unique ID of the workspace
   * @param workspaceName - The name of the workspace (optional, for container name generation)
   * @returns Array of blob names
   */
  public async listWorkspaceBlobs(workspaceId: string, workspaceName?: string): Promise<string[]> {
    try {
      if (!blobServiceClient) {
        logger.warn('Blob service client not initialized');
        return [];
      }

      // Use the same naming convention as createWorkspaceContainer
      let containerName = `ws-${workspaceId.substring(0, 8)}`;
      if (workspaceName) {
        const sanitizedWorkspaceName = workspaceName.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
        const shortWorkspaceName = sanitizedWorkspaceName.substring(0, 20);
        const shortWorkspaceId = workspaceId.substring(0, 8);
        containerName = `ws-${shortWorkspaceName}-${shortWorkspaceId}`;
      }
      
      const containerClient = blobServiceClient.getContainerClient(containerName);
      
      // Ensure container exists
      await containerClient.createIfNotExists();
      
      const blobNames: string[] = [];
      for await (const blob of containerClient.listBlobsFlat()) {
        blobNames.push(blob.name);
      }
      
      return blobNames;
    } catch (error) {
      logger.error(`Failed to list blobs for workspace ${workspaceId}:`, error);
      return [];
    }
  }

  /**
   * Get file stream from a specific workspace container
   * @param fileName - The name of the file in the container
   * @param containerName - The name of the workspace container
   * @returns File stream
   */
  public async getFileStreamFromContainer(fileName: string, containerName: string): Promise<NodeJS.ReadableStream> {
    try {
      if (!blobServiceClient) {
        throw new Error('Blob service client not initialized');
      }

      const containerClient = blobServiceClient.getContainerClient(containerName);
      const blobClient = containerClient.getBlobClient(fileName);
      
      const downloadResponse = await blobClient.download();
      if (!downloadResponse.readableStreamBody) {
        throw new Error('Failed to get file stream');
      }
      
      return downloadResponse.readableStreamBody;
    } catch (error) {
      logger.error(`Failed to get file stream from container ${containerName}:`, error);
      throw new Error('Failed to download file from workspace container');
    }
  }

  /**
   * List files with metadata in a workspace container
   * @param containerName - The name of the workspace container
   * @returns Array of file information
   */
  public async listContainerFiles(containerName: string): Promise<Array<{
    name: string;
    size: number;
    lastModified: Date;
    url: string;
  }>> {
    try {
      if (!blobServiceClient) {
        logger.warn('Blob service client not initialized');
        return [];
      }

      const containerClient = blobServiceClient.getContainerClient(containerName);
      const files = [];
      
      for await (const blob of containerClient.listBlobsFlat()) {
        const blobClient = containerClient.getBlobClient(blob.name);
        files.push({
          name: blob.name,
          size: blob.properties.contentLength || 0,
          lastModified: blob.properties.lastModified || new Date(),
          url: blobClient.url
        });
      }
      
      return files;
    } catch (error) {
      logger.error(`Failed to list files in container ${containerName}:`, error);
      return [];
    }
  }
}
