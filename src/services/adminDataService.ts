import { AIDataService } from './aiDataService';
import { FabricDataAgentService } from './fabricDataAgent';
import { logger } from '../utils/logger';

export interface AdminDataQuery {
  question: string;
  userId: string;
  datasetId?: string;
  connectionId?: string;
  workspaceId?: string;
  queryType?: 'dax' | 'sql';
  includeVisualization?: boolean;
}

export interface AdminDataResult {
  answer: string;
  data?: any;
  query?: string;
  queryType?: 'dax' | 'sql';
  visualization?: any;
  confidence: number;
  executionTime: number;
  tokens?: number;
}

export class AdminDataService {
  private static instance: AdminDataService;
  private aiDataService: AIDataService;
  private fabricService: FabricDataAgentService;

  private constructor() {
    this.aiDataService = AIDataService.getInstance();
    this.fabricService = FabricDataAgentService.getInstance();
    logger.info('✅ Admin Data Service initialized');
  }

  public static getInstance(): AdminDataService {
    if (!AdminDataService.instance) {
      AdminDataService.instance = new AdminDataService();
    }
    return AdminDataService.instance;
  }

  /**
   * Process admin data question with elevated privileges
   */
  public async processAdminDataQuestion(params: AdminDataQuery): Promise<AdminDataResult> {
    try {
      logger.info(`Admin data question from user ${params.userId}: ${params.question}`);

      // Use the existing AI data service with admin context
      const result = await this.aiDataService.processDataQuestion({
        ...params
        // adminContext flag removed as it's not in the DataInsightRequest interface
      });

      logger.info(`Admin data question processed successfully for user ${params.userId}`);
      return result;

    } catch (error) {
      logger.error('Admin data question processing error:', error);
      throw new Error(`Failed to process admin data question: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Execute admin query with elevated privileges
   */
  public async executeAdminQuery(
    query: string,
    queryType: 'dax' | 'sql',
    options: {
      datasetId?: string;
      connectionId?: string;
      workspaceId?: string;
      userId: string;
    }
  ): Promise<any> {
    try {
      logger.info(`Admin direct query execution from user ${options.userId}: ${queryType.toUpperCase()}`);

      let result;
      if (queryType === 'dax') {
        if (!options.datasetId) {
          throw new Error('Dataset ID required for DAX queries');
        }
        result = await this.fabricService.executeDaxQuery(
          options.datasetId, 
          query, 
          options.workspaceId
        );
      } else {
        result = await this.fabricService.executeSqlQuery(
          query, 
          options.workspaceId, 
          options.connectionId
        );
      }

      logger.info(`Admin query executed successfully for user ${options.userId}`);
      return result;

    } catch (error) {
      logger.error('Admin query execution error:', error);
      throw new Error(`Failed to execute admin query: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get all available datasets for admin
   */
  public async getAdminDatasets(workspaceId?: string): Promise<any[]> {
    try {
      logger.info('Getting admin datasets');
      const datasets = await this.aiDataService.getAvailableDatasets(workspaceId);
      return datasets;
    } catch (error) {
      logger.error('Get admin datasets error:', error);
      throw new Error(`Failed to retrieve admin datasets: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get dataset schema for admin
   */
  public async getAdminDatasetSchema(datasetId: string, workspaceId?: string): Promise<any> {
    try {
      logger.info(`Getting admin dataset schema for ${datasetId}`);
      const schema = await this.aiDataService.getDatasetSchema(datasetId, workspaceId);
      return schema;
    } catch (error) {
      logger.error('Get admin dataset schema error:', error);
      throw new Error(`Failed to retrieve admin dataset schema: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Analyze question for admin with additional insights
   */
  public async analyzeAdminQuestion(question: string): Promise<any> {
    try {
      logger.info(`Analyzing admin question: ${question}`);
      const analysis = await this.fabricService.analyzeQuestion(question);
      
      // Add admin-specific analysis
      return {
        ...analysis,
        adminInsights: {
          securityLevel: this.assessSecurityLevel(question),
          performanceImpact: this.assessPerformanceImpact(question),
          dataAccessLevel: 'admin'
        }
      };
    } catch (error) {
      logger.error('Admin question analysis error:', error);
      throw new Error(`Failed to analyze admin question: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Assess security level of the query
   */
  private assessSecurityLevel(question: string): 'low' | 'medium' | 'high' {
    const lowerQuestion = question.toLowerCase();
    
    if (lowerQuestion.includes('delete') || lowerQuestion.includes('drop') || lowerQuestion.includes('truncate')) {
      return 'high';
    }
    
    if (lowerQuestion.includes('update') || lowerQuestion.includes('insert') || lowerQuestion.includes('alter')) {
      return 'medium';
    }
    
    return 'low';
  }

  /**
   * Assess performance impact of the query
   */
  private assessPerformanceImpact(question: string): 'low' | 'medium' | 'high' {
    const lowerQuestion = question.toLowerCase();
    
    if (lowerQuestion.includes('all') || lowerQuestion.includes('entire') || lowerQuestion.includes('complete')) {
      return 'high';
    }
    
    if (lowerQuestion.includes('large') || lowerQuestion.includes('many') || lowerQuestion.includes('bulk')) {
      return 'medium';
    }
    
    return 'low';
  }
}