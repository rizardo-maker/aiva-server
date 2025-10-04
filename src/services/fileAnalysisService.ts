import { StorageService } from './storage';
import { WorkspaceStorageService } from './workspaceStorage';
import { logger } from '../utils/logger';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';

export interface FileContentResult {
  fileName: string;
  originalName: string;
  content: string;
  size: number;
  extractedAt: Date;
}

export class FileAnalysisService {
  private static instance: FileAnalysisService;
  private storageService: StorageService;
  private workspaceStorageService: WorkspaceStorageService;

  private constructor() {
    this.storageService = StorageService.getInstance();
    this.workspaceStorageService = WorkspaceStorageService.getInstance();
  }

  public static getInstance(): FileAnalysisService {
    if (!FileAnalysisService.instance) {
      FileAnalysisService.instance = new FileAnalysisService();
    }
    return FileAnalysisService.instance;
  }

  /**
   * Extract content from file for AI analysis
   */
  public async extractFileContent(
    fileName: string, 
    originalName: string, 
    containerName?: string
  ): Promise<FileContentResult> {
    try {
      logger.info(`Extracting content from file: ${fileName} (container: ${containerName || 'default'})`);
      
      // Get file stream from appropriate container
      let fileStream: NodeJS.ReadableStream;
      if (containerName) {
        fileStream = await this.workspaceStorageService.getFileStreamFromContainer(fileName, containerName);
      } else {
        fileStream = await this.storageService.getFileStream(fileName);
      }
      
      const buffer = await this.streamToBuffer(fileStream);
      const fileExtension = originalName.split('.').pop()?.toLowerCase() || '';
      
      let extractedContent = '';
      
      switch (fileExtension) {
        case 'pdf':
          extractedContent = await this.extractPdfContent(buffer);
          break;
        case 'docx':
          extractedContent = await this.extractDocxContent(buffer);
          break;
        case 'xlsx':
        case 'xls':
          extractedContent = await this.extractExcelContent(buffer);
          break;
        case 'txt':
        case 'md':
        case 'csv':
          extractedContent = buffer.toString('utf-8');
          break;
        default:
          try {
            extractedContent = buffer.toString('utf-8');
          } catch (error) {
            extractedContent = `[Content extraction not supported for .${fileExtension} files]`;
          }
      }
      
      // Truncate for token limits (approximately 2000 tokens)
      const truncatedContent = this.truncateContentForTokens(extractedContent, 2000);
      
      return {
        fileName,
        originalName,
        content: truncatedContent,
        size: buffer.length,
        extractedAt: new Date()
      };
    } catch (error) {
      logger.error(`Failed to extract content from ${fileName}:`, error);
      return {
        fileName,
        originalName,
        content: `[Error extracting content: ${error instanceof Error ? error.message : 'Unknown error'}]`,
        size: 0,
        extractedAt: new Date()
      };
    }
  }

  /**
   * Extract text content from PDF buffer
   */
  private async extractPdfContent(buffer: Buffer): Promise<string> {
    try {
      const data = await pdf(buffer);
      return data.text;
    } catch (error) {
      logger.error('PDF extraction error:', error);
      return '[Error extracting PDF content]';
    }
  }

  /**
   * Extract text content from DOCX buffer
   */
  private async extractDocxContent(buffer: Buffer): Promise<string> {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    } catch (error) {
      logger.error('DOCX extraction error:', error);
      return '[Error extracting DOCX content]';
    }
  }

  /**
   * Extract text content from Excel buffer
   */
  private async extractExcelContent(buffer: Buffer): Promise<string> {
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheets = [];
      
      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const csvContent = XLSX.utils.sheet_to_csv(worksheet);
        if (csvContent.trim()) {
          sheets.push(`Sheet: ${sheetName}\n${csvContent}`);
        }
      }
      
      return sheets.join('\n\n');
    } catch (error) {
      logger.error('Excel extraction error:', error);
      return '[Error extracting Excel content]';
    }
  }

  /**
   * Convert stream to buffer
   */
  private async streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  /**
   * Truncate content to approximate token count
   */
  private truncateContentForTokens(content: string, maxTokens: number): string {
    // Rough approximation: 1 token ≈ 4 characters
    const maxChars = maxTokens * 4;
    
    if (content.length <= maxChars) {
      return content;
    }
    
    const truncated = content.substring(0, maxChars);
    const lastSpaceIndex = truncated.lastIndexOf(' ');
    
    if (lastSpaceIndex > maxChars * 0.8) {
      return truncated.substring(0, lastSpaceIndex) + '\n\n[Content truncated for length...]';
    } else {
      return truncated + '\n\n[Content truncated for length...]';
    }
  }

  /**
   * Analyze multiple files for batch processing
   */
  public async analyzeMultipleFiles(
    files: Array<{ fileName: string; originalName: string; containerName?: string }>
  ): Promise<FileContentResult[]> {
    const results: FileContentResult[] = [];
    
    for (const file of files) {
      try {
        const result = await this.extractFileContent(
          file.fileName,
          file.originalName,
          file.containerName
        );
        results.push(result);
      } catch (error) {
        logger.error(`Failed to analyze file ${file.fileName}:`, error);
        results.push({
          fileName: file.fileName,
          originalName: file.originalName,
          content: '[Error analyzing file]',
          size: 0,
          extractedAt: new Date()
        });
      }
    }
    
    return results;
  }
}