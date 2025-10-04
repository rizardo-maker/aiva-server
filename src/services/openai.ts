import { OpenAIClient, AzureKeyCredential } from '@azure/openai';
import OpenAI from 'openai';
import { logger } from '../utils/logger';

// Explicitly load environment variables
import dotenv from 'dotenv';
dotenv.config();

// Set default timeout for Azure OpenAI requests
const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stream?: boolean;
}

export class OpenAIService {
  private static instance: OpenAIService | null = null;
  private azureClient?: OpenAIClient;
  private openaiClient?: OpenAI;
  private deploymentName: string = '';
  private useAzure: boolean = false;

  private constructor() {
    this.initializeClient();
    logger.info('✅ OpenAI service initialized');
  }

  private initializeClient(): void {
    // Explicitly load environment variables
    require('dotenv').config();
    
    const apiKey = process.env.AZURE_OPENAI_API_KEY || process.env.OPENAI_API_KEY;
    const mockOpenAI = process.env.MOCK_OPENAI === 'true';
    
    // Determine if we should use Azure OpenAI or regular OpenAI based on API key format
    this.useAzure = apiKey ? !apiKey.startsWith('sk-') : false;
    
    logger.info('OpenAI Service Configuration:');
    logger.info(`- apiKey: ${apiKey ? 'SET' : 'NOT SET'}`);
    logger.info(`- useAzure: ${this.useAzure}`);
    logger.info(`- mockOpenAI: ${mockOpenAI}`);

    // Use mock client only if explicitly requested
    if (mockOpenAI) {
      logger.warn('MOCK_OPENAI is set to true. Using mock client.');
      this.setupMockClient();
      return;
    }

    if (!apiKey) {
      throw new Error('OpenAI API key is required but missing. Please check your environment variables.');
    }

    try {
      if (this.useAzure) {
        this.initializeAzureClient(apiKey);
      } else {
        this.initializeOpenAIClient(apiKey);
      }
    } catch (error) {
      logger.error('Failed to initialize OpenAI client:', error);
      throw new Error(`OpenAI client initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private initializeAzureClient(apiKey: string): void {
    let endpoint = process.env.AZURE_OPENAI_ENDPOINT || '';
    
    // Clean up the endpoint URL
    if (endpoint.endsWith('/models')) {
      endpoint = endpoint.substring(0, endpoint.length - '/models'.length);
    }
    if (endpoint.includes('/openai/deployments/')) {
      try {
        const url = new URL(endpoint);
        endpoint = `${url.protocol}//${url.hostname}`;
      } catch (e) {
        logger.error('Failed to parse endpoint URL', e);
      }
    }
    if (endpoint.endsWith('/')) {
      endpoint = endpoint.slice(0, -1);
    }
    
    this.deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-4';
    
    if (!endpoint) {
      throw new Error('Azure OpenAI endpoint is required when using Azure OpenAI.');
    }
    
    logger.info(`Initializing Azure OpenAI client with endpoint: ${endpoint}`);
    logger.info(`- deploymentName: ${this.deploymentName}`);
    
    const credential = new AzureKeyCredential(apiKey);
    this.azureClient = new OpenAIClient(endpoint, credential);
    logger.info('Azure OpenAI client initialized successfully');
  }

  private initializeOpenAIClient(apiKey: string): void {
    logger.info('Initializing regular OpenAI client');
    
    this.openaiClient = new OpenAI({
      apiKey: apiKey,
    });
    
    // Set default model for regular OpenAI
    this.deploymentName = process.env.OPENAI_MODEL || 'gpt-4';
    logger.info(`- model: ${this.deploymentName}`);
    logger.info('OpenAI client initialized successfully');
  }

  private setupMockClient(): void {
    // Mock client setup remains the same
    this.azureClient = {
      getChatCompletions: async (deploymentName: string, messages: any[]) => {
        const userMessage = messages[messages.length - 1]?.content || '';
        const intelligentResponse = this.generateIntelligentResponse(userMessage);
        
        return {
          choices: [{
            message: {
              role: 'assistant',
              content: intelligentResponse
            },
            finishReason: 'stop'
          }],
          usage: {
            totalTokens: Math.floor((userMessage.length + intelligentResponse.length) / 4)
          }
        };
      },
      getModels: async () => ({
        models: [{
          id: 'gpt-4',
          object: 'model',
          created: Date.now(),
          ownedBy: 'mock'
        }]
      }),
      streamChatCompletions: async function* () {
        yield {
          choices: [{
            delta: {
              content: 'This is a mock streaming response from the OpenAI service.'
            }
          }]
        };
      }
    } as unknown as OpenAIClient;
  }

  public static getInstance(): OpenAIService {
    if (!OpenAIService.instance) {
      OpenAIService.instance = new OpenAIService();
    }
    return OpenAIService.instance;
  }

  public static resetInstance(): void {
    OpenAIService.instance = null;
  }

  public reconfigure(): void {
    try {
      this.initializeClient();
      logger.info('✅ OpenAI service reconfigured successfully');
    } catch (error) {
      logger.error('Failed to reconfigure OpenAI service:', error);
      throw error;
    }
  }

  public async getChatCompletion(
    messages: ChatMessage[],
    options: ChatCompletionOptions = {}
  ): Promise<{ content: string; tokens: number }> {
    try {
      const {
        maxTokens = 1000,
        temperature = 0.7,
        topP = 1,
        frequencyPenalty = 0,
        presencePenalty = 0
      } = options;

      // Check if we're using mock mode
      if (process.env.MOCK_OPENAI === 'true') {
        logger.info('Using intelligent mock OpenAI response');
        const userMessage = messages[messages.length - 1]?.content || '';
        const intelligentResponse = this.generateIntelligentResponse(userMessage);
        return {
          content: intelligentResponse,
          tokens: Math.floor(intelligentResponse.length / 4)
        };
      }

      if (this.useAzure && this.azureClient) {
        return await this.getAzureChatCompletion(messages, options);
      } else if (this.openaiClient) {
        return await this.getOpenAIChatCompletion(messages, options);
      } else {
        throw new Error('No OpenAI client initialized');
      }
    } catch (error) {
      logger.error('OpenAI API error:', error);
      
      // Check if this is a timeout or network error
      if (error instanceof Error) {
        const errorMessage = error.message.toLowerCase();
        
        if (errorMessage.includes('timeout') || errorMessage.includes('timed out') || errorMessage.includes('network')) {
          logger.error('Azure OpenAI request timed out');
          throw new Error('The AI service is taking too long to respond. Please try again.');
        }
        
        if (errorMessage.includes('429') || errorMessage.includes('too many requests') || errorMessage.includes('rate limit')) {
          logger.error('Azure OpenAI rate limit exceeded');
          throw new Error('The AI service is currently overloaded. Please wait a moment and try again.');
        }
        
        if (errorMessage.includes('401') || errorMessage.includes('unauthorized') || errorMessage.includes('authentication')) {
          logger.error('Azure OpenAI authentication failed');
          throw new Error('AI service authentication failed. Please contact support.');
        }
        
        if (errorMessage.includes('404') || errorMessage.includes('not found') || errorMessage.includes('deployment')) {
          logger.error(`Azure OpenAI deployment '${this.deploymentName}' not found`);
          throw new Error('The AI model configuration is incorrect. Please contact support.');
        }
      }
      
      // Generic error message
      throw new Error('Failed to get AI response. Please try again.');
    }
  }

  private async getAzureChatCompletion(
    messages: ChatMessage[],
    options: ChatCompletionOptions
  ): Promise<{ content: string; tokens: number }> {
    const {
      maxTokens = 1000,
      temperature = 0.7,
      topP = 1,
      frequencyPenalty = 0,
      presencePenalty = 0
    } = options;

    logger.info(`Sending request to Azure OpenAI (${this.deploymentName})`);
    
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error('Request to Azure OpenAI timed out'));
      }, DEFAULT_TIMEOUT_MS + 5000);
    });
    
    const requestPromise = this.azureClient!.getChatCompletions(
      this.deploymentName,
      messages,
      {
        maxTokens,
        temperature,
        topP,
        frequencyPenalty,
        presencePenalty
      }
    );
    
    const response = await Promise.race([requestPromise, timeoutPromise]);

    const choice = response.choices[0];
    if (!choice?.message?.content) {
      throw new Error('No response content received from Azure OpenAI');
    }

    logger.info(`Received response from Azure OpenAI (${response.usage?.totalTokens || 'unknown'} tokens)`);
    return {
      content: choice.message.content,
      tokens: response.usage?.totalTokens || 0
    };
  }

  private async getOpenAIChatCompletion(
    messages: ChatMessage[],
    options: ChatCompletionOptions
  ): Promise<{ content: string; tokens: number }> {
    const {
      maxTokens = 1000,
      temperature = 0.7,
      topP = 1,
      frequencyPenalty = 0,
      presencePenalty = 0
    } = options;

    logger.info(`Sending request to OpenAI (${this.deploymentName})`);
    
    const response = await this.openaiClient!.chat.completions.create({
      model: this.deploymentName,
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      max_tokens: maxTokens,
      temperature,
      top_p: topP,
      frequency_penalty: frequencyPenalty,
      presence_penalty: presencePenalty
    });

    const choice = response.choices[0];
    if (!choice?.message?.content) {
      throw new Error('No response content received from OpenAI');
    }

    logger.info(`Received response from OpenAI (${response.usage?.total_tokens || 'unknown'} tokens)`);
    return {
      content: choice.message.content,
      tokens: response.usage?.total_tokens || 0
    };
  }

  public async getStreamingChatCompletion(
    messages: ChatMessage[],
    options: ChatCompletionOptions = {}
  ): Promise<AsyncIterable<string>> {
    try {
      const {
        maxTokens = 1000,
        temperature = 0.7,
        topP = 1,
        frequencyPenalty = 0,
        presencePenalty = 0
      } = options;

      // Check if we're using mock mode
      if (process.env.MOCK_OPENAI === 'true') {
        logger.info('Using mock OpenAI streaming response');
        return (async function* mockStream() {
          yield 'This is a mock streaming ';
          await new Promise(resolve => setTimeout(resolve, 300));
          yield 'response from the OpenAI service. ';
          await new Promise(resolve => setTimeout(resolve, 300));
          yield 'In a production environment, this would be a streaming response.';
        })();
      }

      if (this.useAzure && this.azureClient) {
        logger.info(`Sending streaming request to Azure OpenAI (${this.deploymentName})`);
        
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error('Streaming request to Azure OpenAI timed out'));
          }, DEFAULT_TIMEOUT_MS + 5000);
        });
        
        const requestPromise = this.azureClient.streamChatCompletions(
          this.deploymentName,
          messages,
          {
            maxTokens,
            temperature,
            topP,
            frequencyPenalty,
            presencePenalty
          }
        );
        
        const response = await Promise.race([requestPromise, timeoutPromise]);
        return this.processStreamingResponse(response);
      } else if (this.openaiClient) {
        logger.info(`Sending streaming request to OpenAI (${this.deploymentName})`);
        
        const stream = await this.openaiClient.chat.completions.create({
          model: this.deploymentName,
          messages: messages.map(msg => ({
            role: msg.role,
            content: msg.content
          })),
          max_tokens: maxTokens,
          temperature,
          top_p: topP,
          frequency_penalty: frequencyPenalty,
          presence_penalty: presencePenalty,
          stream: true
        });
        
        return this.processOpenAIStreamingResponse(stream);
      } else {
        throw new Error('No OpenAI client initialized');
      }
    } catch (error) {
      logger.error('Azure OpenAI streaming API error:', error);
      
      // Check if this is a timeout or network error
      if (error instanceof Error) {
        const errorMessage = error.message.toLowerCase();
        
        if (errorMessage.includes('timeout') || errorMessage.includes('timed out') || errorMessage.includes('network')) {
          logger.error('Azure OpenAI streaming request timed out');
          throw new Error('The AI service is taking too long to respond. Please try again.');
        }
        
        if (errorMessage.includes('429') || errorMessage.includes('too many requests') || errorMessage.includes('rate limit')) {
          logger.error('Azure OpenAI rate limit exceeded');
          throw new Error('The AI service is currently overloaded. Please wait a moment and try again.');
        }
        
        if (errorMessage.includes('401') || errorMessage.includes('unauthorized') || errorMessage.includes('authentication')) {
          logger.error('Azure OpenAI authentication failed');
          throw new Error('AI service authentication failed. Please contact support.');
        }
        
        if (errorMessage.includes('404') || errorMessage.includes('not found') || errorMessage.includes('deployment')) {
          logger.error(`Azure OpenAI deployment '${this.deploymentName}' not found`);
          throw new Error('The AI model configuration is incorrect. Please contact support.');
        }
      }
      
      throw new Error('Failed to get streaming AI response. Please try again.');
    }
  }

  private async* processStreamingResponse(
    response: AsyncIterable<any>
  ): AsyncIterable<string> {
    try {
      let chunkCount = 0;
      for await (const chunk of response) {
        chunkCount++;
        const choice = chunk.choices[0];
        if (choice?.delta?.content) {
          yield choice.delta.content;
        }
      }
      logger.info(`Completed streaming response from Azure OpenAI (${chunkCount} chunks)`);
    } catch (error) {
      logger.error('Error processing streaming response:', error);
      throw new Error('Error processing AI response stream. Please try again.');
    }
  }

  private async* processOpenAIStreamingResponse(
    stream: AsyncIterable<any>
  ): AsyncIterable<string> {
    try {
      let chunkCount = 0;
      for await (const chunk of stream) {
        chunkCount++;
        const choice = chunk.choices[0];
        if (choice?.delta?.content) {
          yield choice.delta.content;
        }
      }
      logger.info(`Completed streaming response from OpenAI (${chunkCount} chunks)`);
    } catch (error) {
      logger.error('Error processing OpenAI streaming response:', error);
      throw new Error('Error processing AI response stream. Please try again.');
    }
  }

  private generateIntelligentResponse(userMessage: string): string {
    const message = userMessage.toLowerCase().trim();
    
    // Greeting responses
    if (message === 'hi' || message === 'hello' || message === 'hey' || 
        message === 'hi there' || message === 'hello there' || message === 'hey there' ||
        message === 'good morning' || message === 'good afternoon' || message === 'good evening' ||
        message.startsWith('hi ') || message.startsWith('hello ') || message.startsWith('hey ')) {
      const greetings = [
        "Hello! I'm AIVA, your AI assistant. How can I help you today?",
        "Hi there! I'm here to assist you with any questions or tasks you have.",
        "Hey! Great to meet you. What would you like to know or discuss?",
        "Hello! I'm AIVA, ready to help you with information, analysis, or creative tasks."
      ];
      return greetings[Math.floor(Math.random() * greetings.length)];
    }

    // Specific person questions
    if (message.includes('who is') || message.includes('tell me about')) {
      if (message.includes('elon musk')) {
        return "Elon Musk is a prominent entrepreneur and business magnate known for:\n\n• **Tesla**: CEO of the electric vehicle and clean energy company\n• **SpaceX**: Founder and CEO, revolutionizing space exploration and satellite internet (Starlink)\n• **X (formerly Twitter)**: Owner since 2022, transformed the social media platform\n• **Neuralink**: Co-founder, developing brain-computer interface technology\n• **The Boring Company**: Founder, working on tunnel construction and transportation\n\n**Background**: Born in South Africa (1971), moved to the US and co-founded PayPal, which was sold to eBay for $1.5B. Known for ambitious goals like Mars colonization and sustainable energy. Often considered one of the world's richest people with a net worth fluctuating around $200+ billion.\n\nWould you like to know more about any specific aspect of his work or companies?";
      }
      if (message.includes('bill gates')) {
        return "Bill Gates is a technology pioneer and philanthropist:\n\n• **Microsoft Co-founder**: Built the world's largest software company, created Windows OS\n• **Philanthropist**: Co-chairs the Bill & Melinda Gates Foundation, focusing on global health and education\n• **Author**: Wrote several books including 'How to Avoid a Climate Disaster'\n• **Investor**: Active in clean energy and health technology investments\n\n**Legacy**: Revolutionized personal computing, became world's richest person for many years, now dedicates most time to philanthropy and addressing global challenges like disease, poverty, and climate change.\n\nWhat specific aspect would you like to know more about?";
      }
      if (message.includes('steve jobs')) {
        return "Steve Jobs (1955-2011) was Apple's co-founder and visionary leader:\n\n• **Apple**: Co-founded in 1976, revolutionized personal computers, phones, and tablets\n• **Products**: Led creation of Mac, iPod, iPhone, and iPad\n• **Pixar**: Founded the animation studio, created Toy Story and other hit films\n• **Design Philosophy**: Known for minimalist design and user-focused products\n\n**Impact**: Transformed multiple industries (computers, music, phones, animation) and established Apple as one of the world's most valuable companies. Known for perfectionism and innovative product launches.\n\nWould you like to know more about his innovations or business philosophy?";
      }
    }

    // Stock and finance questions
    if (message.includes('stock') || message.includes('invest') || message.includes('profit') || message.includes('share')) {
      if (message.includes('high profit') || message.includes('profitable') || message.includes('best stock')) {
        return "I can help you understand profitable stock analysis! Some key factors for high-profit stocks include:\n\n• **Technology**: Companies like Apple (AAPL), Microsoft (MSFT), and NVIDIA (NVDA) have shown strong profitability\n• **Healthcare**: Johnson & Johnson (JNJ) and Pfizer (PFE) often maintain steady profits\n• **Financial Services**: JPMorgan Chase (JPM) and Berkshire Hathaway (BRK.A)\n\nKey metrics to consider:\n- P/E ratio\n- Revenue growth\n- Profit margins\n- Market position\n\nWould you like me to explain any specific aspect of stock analysis or discuss a particular sector?";
      }
      if (message.includes('buy') || message.includes('should i')) {
        return "I can provide educational information about investing, but I can't give specific financial advice. Here are some general principles:\n\n• **Diversification**: Don't put all eggs in one basket\n• **Research**: Understand the company's fundamentals\n• **Risk tolerance**: Only invest what you can afford to lose\n• **Long-term thinking**: Markets fluctuate short-term\n• **Professional advice**: Consider consulting a financial advisor\n\nWhat specific aspect of investing would you like to learn more about?";
      }
      return "Investing can be complex but rewarding! I can help explain concepts like market analysis, risk assessment, portfolio diversification, or specific investment strategies. What particular aspect of investing interests you most?";
    }
    
    // Specific question patterns
    if (message.includes('what can you do') || message.includes('what are your capabilities')) {
      return "I can help you with many things! I can answer questions, provide explanations, help with analysis, assist with creative writing, solve problems, discuss various topics, and much more. What specific area would you like help with?";
    }
    
    if (message.includes('who are you') || message.includes('what are you')) {
      return "I'm AIVA (Artificial Intelligence Virtual Assistant), your AI assistant designed to help with a wide variety of tasks. I can answer questions, provide explanations, help with analysis, and engage in meaningful conversations. How can I assist you today?";
    }
    
    if (message.includes('how are you') || message.includes('how do you do')) {
      return "I'm doing great, thank you for asking! I'm here and ready to help you with whatever you need. What can I assist you with today?";
    }
    
    // Specific factual questions - provide informative answers
    if (message.includes('richest') && (message.includes('person') || message.includes('man') || message.includes('woman') || message.includes('world'))) {
      return "Based on recent data, Elon Musk and Bernard Arnault have been competing for the title of world's richest person, with their net worth fluctuating based on stock prices. Other top billionaires include Jeff Bezos, Bill Gates, and Warren Buffett. The exact ranking changes frequently due to market conditions. Would you like to know more about any specific billionaire or wealth trends?";
    }
    
    if (message.includes('time') && (message.includes('what') || message.includes('current'))) {
      const now = new Date();
      return `The current time is ${now.toLocaleTimeString()} on ${now.toLocaleDateString()}. Is there anything specific you'd like to know about time zones or scheduling?`;
    }
    
    if (message.includes('weather') || message.includes('temperature')) {
      return "I don't have access to real-time weather data, but I can help you understand weather patterns, climate information, or suggest reliable weather apps and websites like Weather.com, AccuWeather, or your local meteorological service. What specific weather information are you looking for?";
    }
    
    if (message.includes('news') || message.includes('current events')) {
      return "I don't have access to real-time news, but I can help you understand current topics, explain complex issues, or suggest reliable news sources like Reuters, BBC, AP News, or NPR. What kind of news or current events are you interested in discussing?";
    }
    
    // General question responses - more contextual
    if (message.includes('what') || message.includes('how') || message.includes('why') || message.includes('?')) {
      // Try to give more specific responses based on keywords
      if (message.includes('work') || message.includes('job') || message.includes('career')) {
        return "Career success often depends on a combination of skills, networking, continuous learning, and finding the right opportunities. Key factors include developing both technical and soft skills, building professional relationships, staying adaptable to industry changes, and aligning your work with your values and interests. What specific aspect of career development interests you most?";
      }
      if (message.includes('learn') || message.includes('study') || message.includes('education')) {
        return "Effective learning involves active engagement, spaced repetition, and connecting new information to existing knowledge. Some proven strategies include: setting clear goals, breaking complex topics into smaller parts, practicing regularly, teaching others what you've learned, and using multiple learning methods (visual, auditory, hands-on). What subject or skill are you looking to learn about?";
      }
      if (message.includes('technology') || message.includes('tech') || message.includes('computer')) {
        return "Technology is rapidly evolving across many areas: AI and machine learning are transforming industries, cloud computing enables scalable solutions, mobile technology connects billions globally, and emerging fields like quantum computing and biotechnology promise revolutionary changes. Current trends include automation, cybersecurity, sustainable tech, and human-computer interaction. What specific technology area interests you?";
      }
      if (message.includes('health') || message.includes('fitness') || message.includes('exercise')) {
        return "Good health typically involves regular physical activity, balanced nutrition, adequate sleep, stress management, and preventive healthcare. The WHO recommends at least 150 minutes of moderate exercise weekly, a diet rich in fruits and vegetables, 7-9 hours of sleep, and regular health check-ups. Mental health is equally important through social connections, mindfulness, and professional support when needed. What aspect of health and wellness interests you most?";
      }
      if (message.includes('money') || message.includes('finance') || message.includes('investment')) {
        return "Sound financial management includes budgeting, saving, investing wisely, and managing debt. Key principles: spend less than you earn, build an emergency fund, diversify investments, understand compound interest, and plan for long-term goals like retirement. Popular investment options include index funds, real estate, and retirement accounts. Always consider your risk tolerance and consult financial advisors for personalized advice. What financial topic would you like to explore?";
      }
      
      // Default question response - more helpful
      const responses = [
        "That's a thoughtful question! Let me provide some insights on this topic. Based on current knowledge and best practices, there are several key aspects to consider. What specific angle would you like me to focus on?",
        "Great question! This is an area with many interesting dimensions. I can share some valuable information and perspectives on this. What particular aspect would be most helpful for you?",
        "I'd be happy to help with that! This topic involves several important factors worth exploring. Let me know what specific information would be most useful for your situation.",
        "That's worth discussing! There are some key principles and insights I can share about this. What would be the most helpful way for me to approach this topic for you?"
      ];
      return responses[Math.floor(Math.random() * responses.length)];
    }
    
    // Help requests
    if (message.includes('help') || message.includes('assist') || message.includes('support')) {
      const helpResponses = [
        "I'm here to help! I can assist you with a wide range of tasks including answering questions, providing explanations, helping with analysis, creative writing, problem-solving, and much more. What specific area would you like help with?",
        "Absolutely! I'd be glad to assist you. I can help with research, explanations, brainstorming, writing, data analysis, coding questions, and many other tasks. What do you need help with today?",
        "Of course! I'm designed to be helpful across many different areas. Whether you need information, want to discuss ideas, need help with a project, or have questions about any topic, I'm here to support you. How can I assist?",
        "I'm ready to help! I can provide assistance with various tasks like answering questions, explaining concepts, helping with creative projects, problem-solving, and more. What would you like to work on together?"
      ];
      return helpResponses[Math.floor(Math.random() * helpResponses.length)];
    }
    
    // Technology/AI questions
    if (message.includes('ai') || message.includes('artificial intelligence') || message.includes('technology') || message.includes('computer')) {
      const techResponses = [
        "AI and technology are fascinating fields that are rapidly evolving! There are so many exciting developments happening, from machine learning and natural language processing to robotics and automation. What specific aspect interests you most?",
        "Technology, especially AI, is transforming how we work and live. From improving healthcare and education to enhancing productivity and creativity, AI has tremendous potential. I'd love to discuss any particular area you're curious about!",
        "Artificial Intelligence is a broad field encompassing machine learning, deep learning, natural language processing, computer vision, and more. Each area has unique applications and challenges. What would you like to explore about AI?",
        "The world of technology is incredibly dynamic! AI is just one part of a larger ecosystem that includes cloud computing, mobile development, data science, cybersecurity, and emerging technologies. What interests you most?"
      ];
      return techResponses[Math.floor(Math.random() * techResponses.length)];
    }
    
    // Try to respond based on message content and context
    if (message.includes('thank') || message.includes('thanks')) {
      return "You're very welcome! I'm glad I could help. Is there anything else you'd like to know or discuss?";
    }
    
    if (message.includes('good') || message.includes('great') || message.includes('awesome') || message.includes('excellent')) {
      return "I'm so glad to hear that! It's wonderful when things go well. What else can I help you with today?";
    }
    
    if (message.includes('problem') || message.includes('issue') || message.includes('trouble')) {
      return "I understand you're facing a challenge. I'd be happy to help you work through this problem. Could you tell me more about what's going on?";
    }
    
    if (message.includes('tell me about') || message.includes('explain')) {
      return "I'd be happy to explain that topic for you! To give you the most helpful information, could you be a bit more specific about what aspect you'd like me to focus on?";
    }
    
    // For very short or unclear messages, ask for clarification
    if (message.length < 3 || message.match(/^[a-z]{1,2}$/)) {
      return "I'd love to help you! Could you tell me a bit more about what you're looking for or what you'd like to discuss?";
    }
    
    // Business and economics questions
    if (message.includes('business') || message.includes('market') || message.includes('economy') || message.includes('company')) {
      return "Business and economics are fascinating areas! I can help with topics like market analysis, business strategy, economic trends, company valuation, or industry insights. What specific business topic would you like to explore?";
    }

    // Technology questions
    if (message.includes('ai') || message.includes('artificial intelligence') || message.includes('machine learning') || message.includes('technology')) {
      return "AI and technology are rapidly evolving fields! I can discuss machine learning algorithms, AI applications, emerging technologies, programming concepts, or tech industry trends. What aspect of technology interests you most?";
    }

    // General knowledge questions
    if (message.includes('what is') || message.includes('define') || message.includes('meaning')) {
      return "I'd be happy to explain that concept! Based on your question, I can provide definitions, explanations, examples, and context to help you understand the topic thoroughly. What would you like me to focus on?";
    }

    // How-to questions
    if (message.includes('how to') || message.includes('how do i') || message.includes('steps')) {
      return "Great question! I can provide step-by-step guidance, best practices, tips, and detailed instructions to help you accomplish your goal. What specific process or task would you like help with?";
    }

    // Comparison questions
    if (message.includes('vs') || message.includes('versus') || message.includes('compare') || message.includes('difference')) {
      return "Comparisons can be really helpful for making decisions! I can analyze the pros and cons, key differences, similarities, and help you understand which option might work best for your specific needs. What are you comparing?";
    }

    // Creative and writing questions
    if (message.includes('write') || message.includes('create') || message.includes('story') || message.includes('poem')) {
      return "I love helping with creative projects! I can assist with writing, brainstorming ideas, editing, storytelling, poetry, or any other creative endeavor. What kind of creative project are you working on?";
    }

    // Math and calculations
    if (message.includes('calculate') || message.includes('math') || message.includes('formula') || /\d+/.test(message)) {
      return "I can help with mathematical problems, calculations, formulas, statistics, and data analysis! Whether it's basic arithmetic, complex equations, or interpreting numerical data, I'm here to assist. What calculation do you need help with?";
    }

    // Science and technology questions
    if (message.includes('what is') || message.includes('explain') || message.includes('how does')) {
      if (message.includes('ai') || message.includes('artificial intelligence')) {
        return "Artificial Intelligence (AI) refers to computer systems that can perform tasks typically requiring human intelligence:\n\n• **Machine Learning**: Systems that learn from data without explicit programming\n• **Natural Language Processing**: Understanding and generating human language\n• **Computer Vision**: Interpreting and analyzing visual information\n• **Neural Networks**: Computing systems inspired by biological neural networks\n\n**Applications**: AI powers search engines, recommendation systems, autonomous vehicles, medical diagnosis, and virtual assistants like me!\n\n**Types**: Narrow AI (specific tasks) vs General AI (human-level intelligence across domains)\n\nWhat specific aspect of AI would you like to explore further?";
      }
      if (message.includes('blockchain') || message.includes('bitcoin')) {
        return "Blockchain is a distributed ledger technology that maintains a secure, transparent record of transactions:\n\n• **Decentralized**: No single authority controls the network\n• **Immutable**: Records cannot be altered once confirmed\n• **Transparent**: All transactions are publicly visible\n• **Cryptographic**: Uses advanced encryption for security\n\n**Bitcoin**: The first and most famous cryptocurrency, created in 2009 by the pseudonymous Satoshi Nakamoto. It uses blockchain to enable peer-to-peer digital payments without banks.\n\n**Other uses**: Smart contracts, supply chain tracking, digital identity, NFTs\n\nWould you like to know more about how blockchain works or its applications?";
      }
    }

    // Current events and general knowledge
    if (message.includes('climate change') || message.includes('global warming')) {
      return "Climate change refers to long-term shifts in global temperatures and weather patterns:\n\n• **Causes**: Primarily greenhouse gas emissions from burning fossil fuels\n• **Effects**: Rising temperatures, sea level rise, extreme weather events\n• **Evidence**: Scientific consensus based on temperature records, ice core data, satellite measurements\n• **Solutions**: Renewable energy, energy efficiency, carbon capture, policy changes\n\n**Paris Agreement**: Global commitment to limit warming to 1.5°C above pre-industrial levels\n\n**Individual actions**: Reduce energy use, sustainable transportation, support clean energy policies\n\nWhat aspect of climate change would you like to discuss further?";
    }

    // Programming and technology
    if (message.includes('programming') || message.includes('coding') || message.includes('python') || message.includes('javascript')) {
      return "Programming is the process of creating instructions for computers to solve problems:\n\n• **Popular Languages**: Python (data science, AI), JavaScript (web development), Java (enterprise), C++ (systems)\n• **Key Concepts**: Variables, functions, loops, conditionals, data structures\n• **Learning Path**: Start with basics, practice regularly, build projects, join communities\n\n**Python**: Great for beginners, used in AI, data analysis, web development\n**JavaScript**: Essential for web development, runs in browsers and servers\n\n**Getting Started**: Choose a language, use online tutorials (freeCodeCamp, Codecademy), practice on coding platforms\n\nWhat programming topic or language interests you most?";
    }

    // For questions that don't match specific patterns, provide helpful general response
    if (message.includes('?') || message.includes('what') || message.includes('how') || message.includes('why')) {
      return "I'd be happy to help answer your question! While I may not have specific information about every topic, I can provide general knowledge, explanations, and guidance on a wide range of subjects including:\n\n• Technology and science\n• Business and finance\n• History and current events\n• Programming and AI\n• General knowledge topics\n\nCould you rephrase your question or provide more context so I can give you the most helpful response possible?";
    }

    // Default helpful response
    return "I'm here to help! I can assist with questions about technology, business, science, programming, current events, and many other topics. What would you like to know or discuss today?";
  }

  public async moderateContent(content: string): Promise<boolean> {
    try {
      // Note: Azure OpenAI might not have moderation endpoint
      // Implement basic content filtering here or use Azure Content Safety
      const flaggedWords = ['spam', 'abuse', 'harmful'];
      const lowerContent = content.toLowerCase();
      
      return flaggedWords.some(word => lowerContent.includes(word));
    } catch (error) {
      logger.error('Content moderation error:', error);
      return false; // Allow content if moderation fails
    }
  }

  public getSystemPrompt(): string {
    return `You are AIVA (Alyasra Intelligent Virtual Assistant), a helpful AI assistant designed to help with business analytics, data insights, and decision-making. 

Key guidelines:
- Provide accurate, helpful, and professional responses
- Focus on business intelligence and data analysis when relevant
- Be concise but thorough in your explanations
- If you're unsure about something, acknowledge it
- Maintain a professional yet friendly tone
- Respect user privacy and data security

Current date: ${new Date().toISOString().split('T')[0]}`;
  }
}