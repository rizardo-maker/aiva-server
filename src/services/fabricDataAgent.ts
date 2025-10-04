import { DefaultAzureCredential } from '@azure/identity';
import { logger } from '../utils/logger';
import { CacheService } from './cache';

export interface DataQuery {
  query: string;
  queryType: 'dax' | 'sql';
  dataset?: string;
  workspace?: string;
}

export interface DataResult {
  data: any[];
  columns: string[];
  rowCount: number;
  executionTime: number;
  queryType: 'dax' | 'sql';
  cached: boolean;
}

export interface FabricDatasetInfo {
  id: string;
  name: string;
  workspace: string;
  tables: string[];
  lastRefresh: string;
}

export class FabricDataAgentService {
  private static instance: FabricDataAgentService;
  private credential: DefaultAzureCredential;
  private cacheService: CacheService;
  private baseUrl: string;
  private workspaceId: string;

  private constructor() {
    this.credential = new DefaultAzureCredential();
    this.cacheService = CacheService.getInstance();
    this.baseUrl = process.env.FABRIC_API_BASE_URL || 'https://api.fabric.microsoft.com/v1';
    this.workspaceId = process.env.FABRIC_WORKSPACE_ID || '';
    
    if (!this.workspaceId) {
      logger.warn('FABRIC_WORKSPACE_ID not configured. Some features may not work.');
    }
    
    logger.info('✅ Fabric Data Agent service initialized');
  }

  public static getInstance(): FabricDataAgentService {
    if (!FabricDataAgentService.instance) {
      FabricDataAgentService.instance = new FabricDataAgentService();
    }
    return FabricDataAgentService.instance;
  }

  /**
   * Get access token for Fabric API
   */
  private async getAccessToken(): Promise<string> {
    try {
      const tokenResponse = await this.credential.getToken('https://analysis.windows.net/powerbi/api/.default');
      return tokenResponse.token;
    } catch (error) {
      logger.error('Failed to get Fabric access token:', error);
      throw new Error('Authentication failed for Fabric Data Agent');
    }
  }

  /**
   * Execute DAX query against Fabric dataset
   */
  public async executeDaxQuery(
    datasetId: string,
    daxQuery: string,
    workspaceId?: string
  ): Promise<DataResult> {
    const startTime = Date.now();
    const cacheKey = `dax:${datasetId}:${Buffer.from(daxQuery).toString('base64')}`;
    
    try {
      // Check cache first
      const cachedResult = this.cacheService.get<DataResult>(cacheKey);
      if (cachedResult) {
        logger.info('DAX query result served from cache');
        return { ...cachedResult, cached: true };
      }

      const accessToken = await this.getAccessToken();
      const workspace = workspaceId || this.workspaceId;
      
      const response = await fetch(
        `${this.baseUrl}/workspaces/${workspace}/datasets/${datasetId}/executeQueries`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            queries: [{
              query: daxQuery
            }],
            serializerSettings: {
              includeNulls: true
            }
          })
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Fabric API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json() as { error?: { message: string }, results?: any[] };
      const executionTime = Date.now() - startTime;

      if (result.error) {
        throw new Error(`DAX query error: ${result.error.message}`);
      }

      const queryResult = result.results?.[0];
      const dataResult: DataResult = {
        data: queryResult.tables[0].rows || [],
        columns: queryResult.tables[0].columns?.map((col: any) => col.name) || [],
        rowCount: queryResult.tables[0].rows?.length || 0,
        executionTime,
        queryType: 'dax',
        cached: false
      };

      // Cache the result for 5 minutes
      this.cacheService.set(cacheKey, dataResult, { ttl: 300 });
      
      logger.info(`DAX query executed successfully: ${dataResult.rowCount} rows in ${executionTime}ms`);
      return dataResult;

    } catch (error) {
      logger.error('DAX query execution failed:', error);
      throw new Error(`Failed to execute DAX query: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Execute SQL query against Fabric SQL endpoint
   */
  public async executeSqlQuery(
    sqlQuery: string,
    workspaceId?: string,
    connectionId?: string
  ): Promise<DataResult> {
    const startTime = Date.now();
    const cacheKey = `sql:${Buffer.from(sqlQuery).toString('base64')}`;
    
    try {
      // Check cache first
      const cachedResult = this.cacheService.get<DataResult>(cacheKey);
      if (cachedResult) {
        logger.info('SQL query result served from cache');
        return { ...cachedResult, cached: true };
      }

      const accessToken = await this.getAccessToken();
      const workspace = workspaceId || this.workspaceId;
      
      const response = await fetch(
        `${this.baseUrl}/workspaces/${workspace}/sqlEndpoints/query`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            query: sqlQuery,
            maxRows: 10000 // Configurable limit
          })
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Fabric SQL API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json() as { rows?: any[], columns?: { name: string }[] };
      const executionTime = Date.now() - startTime;

      const dataResult: DataResult = {
        data: result.rows || [],
        columns: result.columns?.map((col: any) => col.name) || [],
        rowCount: result.rows?.length || 0,
        executionTime,
        queryType: 'sql',
        cached: false
      };

      // Cache the result for 5 minutes
      this.cacheService.set(cacheKey, dataResult, { ttl: 300 });
      
      logger.info(`SQL query executed successfully: ${dataResult.rowCount} rows in ${executionTime}ms`);
      return dataResult;

    } catch (error) {
      logger.error('SQL query execution failed:', error);
      throw new Error(`Failed to execute SQL query: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get available datasets in the workspace
   */
  public async getDatasets(workspaceId?: string): Promise<FabricDatasetInfo[]> {
    try {
      const accessToken = await this.getAccessToken();
      const workspace = workspaceId || this.workspaceId;
      
      const response = await fetch(
        `${this.baseUrl}/workspaces/${workspace}/datasets`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch datasets: ${response.status}`);
      }

      const result = await response.json() as { value?: any[] };
      
      return result.value?.map((dataset: any) => ({
        id: dataset.id,
        name: dataset.name,
        workspace: workspace,
        tables: dataset.tables || [],
        lastRefresh: dataset.lastRefresh || new Date().toISOString()
      })) || [];

    } catch (error) {
      logger.error('Failed to get datasets:', error);
      throw new Error(`Failed to retrieve datasets: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get dataset schema information
   */
  public async getDatasetSchema(datasetId: string, workspaceId?: string): Promise<any> {
    try {
      const accessToken = await this.getAccessToken();
      const workspace = workspaceId || this.workspaceId;
      
      const response = await fetch(
        `${this.baseUrl}/workspaces/${workspace}/datasets/${datasetId}/schema`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch dataset schema: ${response.status}`);
      }

      return await response.json();

    } catch (error) {
      logger.error('Failed to get dataset schema:', error);
      throw new Error(`Failed to retrieve dataset schema: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Analyze user question and determine appropriate query type and dataset
   */
  public async analyzeQuestion(question: string): Promise<{
    suggestedQueryType: 'dax' | 'sql';
    suggestedDataset?: string;
    confidence: number;
    reasoning: string;
  }> {
    try {
      // Simple heuristics for query type detection
      const lowerQuestion = question.toLowerCase();
      
      // Keywords that suggest DAX queries
      const daxKeywords = ['measure', 'calculate', 'sum', 'average', 'count', 'filter', 'related', 'earlier'];
      const sqlKeywords = ['select', 'from', 'where', 'join', 'group by', 'order by', 'having'];
      
      const daxScore = daxKeywords.filter(keyword => lowerQuestion.includes(keyword)).length;
      const sqlScore = sqlKeywords.filter(keyword => lowerQuestion.includes(keyword)).length;
      
      let suggestedQueryType: 'dax' | 'sql' = 'sql'; // Default to SQL
      let confidence = 0.5;
      let reasoning = 'Default to SQL for general queries';
      
      if (daxScore > sqlScore) {
        suggestedQueryType = 'dax';
        confidence = Math.min(0.9, 0.5 + (daxScore * 0.1));
        reasoning = `Detected DAX-specific keywords: ${daxKeywords.filter(k => lowerQuestion.includes(k)).join(', ')}`;
      } else if (sqlScore > 0) {
        confidence = Math.min(0.9, 0.5 + (sqlScore * 0.1));
        reasoning = `Detected SQL-specific keywords: ${sqlKeywords.filter(k => lowerQuestion.includes(k)).join(', ')}`;
      }
      
      return {
        suggestedQueryType,
        confidence,
        reasoning
      };

    } catch (error) {
      logger.error('Failed to analyze question:', error);
      return {
        suggestedQueryType: 'sql',
        confidence: 0.5,
        reasoning: 'Error in analysis, defaulting to SQL'
      };
    }
  }

  /**
   * Generate query based on user question and dataset schema
   */
  public async generateQuery(
    question: string,
    queryType: 'dax' | 'sql',
    datasetId?: string,
    schema?: any
  ): Promise<string> {
    try {
      // This would typically use Azure OpenAI to generate the query
      // For now, return a placeholder that can be enhanced
      
      if (queryType === 'dax') {
        return `// Generated DAX query for: ${question}\n// TODO: Implement DAX query generation based on schema`;
      } else {
        return `-- Generated SQL query for: ${question}\n-- TODO: Implement SQL query generation based on schema\nSELECT * FROM [Table] WHERE 1=1;`;
      }

    } catch (error) {
      logger.error('Failed to generate query:', error);
      throw new Error(`Failed to generate ${queryType.toUpperCase()} query`);
    }
  }

  /**
   * Execute query based on user question (main entry point)
   */
  public async executeQuestionQuery(
    question: string,
    options: {
      datasetId?: string;
      workspaceId?: string;
      queryType?: 'dax' | 'sql';
      maxRows?: number;
    } = {}
  ): Promise<{
    data: DataResult;
    query: string;
    queryType: 'dax' | 'sql';
    analysis: any;
  }> {
    try {
      // Analyze the question
      const analysis = await this.analyzeQuestion(question);
      const queryType = options.queryType || analysis.suggestedQueryType;
      
      // Get dataset schema if dataset is specified
      let schema;
      if (options.datasetId) {
        try {
          schema = await this.getDatasetSchema(options.datasetId, options.workspaceId);
        } catch (error) {
          logger.warn('Could not fetch dataset schema:', error);
        }
      }
      
      // Generate query
      const query = await this.generateQuery(question, queryType, options.datasetId, schema);
      
      // Execute query
      let data: DataResult;
      if (queryType === 'dax' && options.datasetId) {
        data = await this.executeDaxQuery(options.datasetId, query, options.workspaceId);
      } else {
        data = await this.executeSqlQuery(query, options.workspaceId);
      }
      
      return {
        data,
        query,
        queryType,
        analysis
      };

    } catch (error) {
      logger.error('Failed to execute question query:', error);
      throw error;
    }
  }
}