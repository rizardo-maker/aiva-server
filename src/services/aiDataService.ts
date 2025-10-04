import { OpenAIService, ChatMessage } from './openai';
import { FabricDataAgentService, DataResult } from './fabricDataAgent';
import { logger } from '../utils/logger';

export interface DataInsightRequest {
  question: string;
  userId: string;
  datasetId?: string;
  connectionId?: string;
  workspaceId?: string;
  queryType?: 'dax' | 'sql';
  includeVisualization?: boolean;
}

export interface DataInsightResponse {
  answer: string;
  data?: DataResult;
  query?: string;
  queryType?: 'dax' | 'sql';
  visualization?: {
    type: 'table' | 'chart' | 'metric';
    config: any;
  };
  confidence: number;
  executionTime: number;
  tokens: number;
}

export class AIDataService {
  private static instance: AIDataService;
  private openAIService: OpenAIService;
  private fabricService: FabricDataAgentService;

  private constructor() {
    this.openAIService = OpenAIService.getInstance();
    this.fabricService = FabricDataAgentService.getInstance();
    logger.info('✅ AI Data service initialized');
  }

  public static getInstance(): AIDataService {
    if (!AIDataService.instance) {
      AIDataService.instance = new AIDataService();
    }
    return AIDataService.instance;
  }

  /**
   * Process user question with enterprise data
   */
  public async processDataQuestion(request: DataInsightRequest): Promise<DataInsightResponse> {
    const startTime = Date.now();
    
    try {
      logger.info(`Processing data question: ${request.question}`);

      // Step 1: Execute query against Fabric Data Agent
      const queryResult = await this.fabricService.executeQuestionQuery(request.question, {
        datasetId: request.datasetId,
        workspaceId: request.workspaceId,
        queryType: request.queryType
      });

      // Step 2: Prepare context for AI
      const dataContext = this.prepareDataContext(queryResult.data, request.question);
      
      // Step 3: Generate AI response with data context
      const aiResponse = await this.generateDataInsight(
        request.question,
        dataContext,
        queryResult.query,
        queryResult.queryType
      );

      // Step 4: Generate visualization if requested
      let visualization;
      if (request.includeVisualization && queryResult.data.rowCount > 0) {
        visualization = this.generateVisualizationConfig(queryResult.data, request.question);
      }

      const executionTime = Date.now() - startTime;

      return {
        answer: aiResponse.content,
        data: queryResult.data,
        query: queryResult.query,
        queryType: queryResult.queryType,
        visualization,
        confidence: queryResult.analysis.confidence,
        executionTime,
        tokens: aiResponse.tokens
      };

    } catch (error) {
      logger.error('Failed to process data question:', error);
      
      // Fallback to regular AI response without data
      const fallbackResponse = await this.openAIService.getChatCompletion([
        {
          role: 'system',
          content: 'You are a helpful AI assistant. The user asked a question but there was an issue accessing the enterprise data. Provide a helpful response and suggest they try again or contact support.'
        },
        {
          role: 'user',
          content: request.question
        }
      ]);

      return {
        answer: `I apologize, but I encountered an issue accessing your enterprise data to answer that question. Here's what I can tell you: ${fallbackResponse.content}\n\nPlease try again or contact support if the issue persists.`,
        confidence: 0.3,
        executionTime: Date.now() - startTime,
        tokens: fallbackResponse.tokens
      };
    }
  }

  /**
   * Prepare data context for AI processing
   */
  private prepareDataContext(dataResult: DataResult, question: string): string {
    if (dataResult.rowCount === 0) {
      return `No data was found for the query. The query executed successfully but returned 0 rows.`;
    }

    // Limit data size for AI context
    const maxRows = 50;
    const limitedData = dataResult.data.slice(0, maxRows);
    
    let context = `Data Query Results:\n`;
    context += `- Query Type: ${dataResult.queryType.toUpperCase()}\n`;
    context += `- Total Rows: ${dataResult.rowCount}\n`;
    context += `- Execution Time: ${dataResult.executionTime}ms\n`;
    context += `- Columns: ${dataResult.columns.join(', ')}\n\n`;
    
    if (dataResult.rowCount > maxRows) {
      context += `Showing first ${maxRows} rows of ${dataResult.rowCount} total rows:\n\n`;
    }

    // Format data as table
    context += this.formatDataAsTable(limitedData, dataResult.columns);
    
    if (dataResult.rowCount > maxRows) {
      context += `\n... and ${dataResult.rowCount - maxRows} more rows`;
    }

    return context;
  }

  /**
   * Format data as a readable table
   */
  private formatDataAsTable(data: any[], columns: string[]): string {
    if (data.length === 0) return 'No data available';

    let table = columns.join('\t') + '\n';
    table += columns.map(() => '---').join('\t') + '\n';
    
    data.forEach(row => {
      const rowValues = columns.map(col => {
        const value = row[col];
        if (value === null || value === undefined) return 'NULL';
        if (typeof value === 'number') return value.toLocaleString();
        if (typeof value === 'string' && value.length > 50) return value.substring(0, 47) + '...';
        return String(value);
      });
      table += rowValues.join('\t') + '\n';
    });

    return table;
  }

  /**
   * Generate AI insight with data context
   */
  private async generateDataInsight(
    question: string,
    dataContext: string,
    query: string,
    queryType: 'dax' | 'sql'
  ): Promise<{ content: string; tokens: number }> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are AIVA (Alyasra Intelligent Virtual Assistant), an expert business intelligence analyst with deep knowledge of data analysis and Microsoft Fabric.

Your role is to:
1. Analyze enterprise data query results
2. Provide clear, actionable business insights
3. Explain trends, patterns, and anomalies
4. Suggest next steps or recommendations
5. Present information in a business-friendly manner

Guidelines:
- Focus on business value and actionable insights
- Use clear, non-technical language for business users
- Highlight key findings and trends
- Provide context and explain what the data means
- Suggest follow-up questions or actions when appropriate
- If data shows concerning trends, mention them diplomatically
- Always be accurate and don't make assumptions beyond what the data shows

Current date: ${new Date().toISOString().split('T')[0]}`
      },
      {
        role: 'user',
        content: `Question: ${question}

Query executed: ${queryType.toUpperCase()}
${query}

${dataContext}

Please analyze this data and provide insights that answer the user's question. Focus on business value and actionable recommendations.`
      }
    ];

    return await this.openAIService.getChatCompletion(messages, {
      maxTokens: 1500,
      temperature: 0.7
    });
  }

  /**
   * Generate visualization configuration
   */
  private generateVisualizationConfig(dataResult: DataResult, question: string): {
    type: 'table' | 'chart' | 'metric';
    config: any;
  } {
    // Simple heuristics for visualization type
    const numericColumns = dataResult.columns.filter(col => {
      const firstValue = dataResult.data[0]?.[col];
      return typeof firstValue === 'number';
    });

    const stringColumns = dataResult.columns.filter(col => {
      const firstValue = dataResult.data[0]?.[col];
      return typeof firstValue === 'string';
    });

    // Single metric
    if (dataResult.rowCount === 1 && numericColumns.length === 1) {
      return {
        type: 'metric',
        config: {
          value: dataResult.data[0][numericColumns[0]],
          label: numericColumns[0],
          format: 'number'
        }
      };
    }

    // Chart for time series or categorical data
    if (numericColumns.length > 0 && stringColumns.length > 0 && dataResult.rowCount <= 50) {
      return {
        type: 'chart',
        config: {
          chartType: 'bar',
          xAxis: stringColumns[0],
          yAxis: numericColumns[0],
          data: dataResult.data
        }
      };
    }

    // Default to table
    return {
      type: 'table',
      config: {
        columns: dataResult.columns,
        data: dataResult.data.slice(0, 100), // Limit for display
        totalRows: dataResult.rowCount
      }
    };
  }

  /**
   * Get available datasets for user
   */
  public async getAvailableDatasets(workspaceId?: string) {
    try {
      return await this.fabricService.getDatasets(workspaceId);
    } catch (error) {
      logger.error('Failed to get available datasets:', error);
      throw error;
    }
  }

  /**
   * Get dataset schema
   */
  public async getDatasetSchema(datasetId: string, workspaceId?: string) {
    try {
      return await this.fabricService.getDatasetSchema(datasetId, workspaceId);
    } catch (error) {
      logger.error('Failed to get dataset schema:', error);
      throw error;
    }
  }
}