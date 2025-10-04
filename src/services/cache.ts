import { logger } from '../utils/logger';

export interface CacheOptions {
  ttl?: number; // Time to live in seconds
}

export class CacheService {
  async initialize() {
    // Check if we should use mock cache
    const mockCache = process.env.MOCK_CACHE === 'true';
    const nodeEnv = process.env.NODE_ENV || 'development';
    
    if (mockCache || nodeEnv === 'development') {
      logger.info('Using mock cache service');
      // Mock cache is already implemented with the Map
      return;
    }
    
    // Real cache implementation would go here
    logger.info('✅ Cache service initialized');
  }
  private static instance: CacheService;
  private cache: Map<string, { value: any; expires: number }>;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  private constructor() {
    this.cache = new Map();
    
    // Clean up expired entries every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);

    logger.info('✅ Cache service initialized');
  }

  public static getInstance(): CacheService {
    if (!CacheService.instance) {
      CacheService.instance = new CacheService();
    }
    return CacheService.instance;
  }

  public set(key: string, value: any, options: CacheOptions = {}): void {
    const { ttl = 3600 } = options; // Default 1 hour
    const expires = Date.now() + (ttl * 1000);
    
    this.cache.set(key, { value, expires });
    logger.debug(`Cache set: ${key} (expires in ${ttl}s)`);
  }

  public get<T = any>(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      logger.debug(`Cache expired: ${key}`);
      return null;
    }

    logger.debug(`Cache hit: ${key}`);
    return entry.value as T;
  }

  public delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      logger.debug(`Cache deleted: ${key}`);
    }
    return deleted;
  }

  public clear(): void {
    this.cache.clear();
    logger.info('Cache cleared');
  }

  public has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return false;
    }
    
    return true;
  }

  public size(): number {
    return this.cache.size;
  }

  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expires) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cache cleanup: removed ${cleaned} expired entries`);
    }
  }

  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.cache.clear();
    logger.info('Cache service destroyed');
  }

  // Helper methods for common cache patterns
  public async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const value = await factory();
    this.set(key, value, options);
    return value;
  }

  public setUserSession(userId: string, sessionData: any, ttl = 86400): void {
    this.set(`session:${userId}`, sessionData, { ttl });
  }

  public getUserSession(userId: string): any {
    return this.get(`session:${userId}`);
  }

  public deleteUserSession(userId: string): boolean {
    return this.delete(`session:${userId}`);
  }

  public setChatHistory(chatId: string, messages: any[], ttl = 3600): void {
    this.set(`chat:${chatId}`, messages, { ttl });
  }

  public getChatHistory(chatId: string): any[] | null {
    return this.get(`chat:${chatId}`);
  }

  public setUserPreferences(userId: string, preferences: any, ttl = 86400): void {
    this.set(`prefs:${userId}`, preferences, { ttl });
  }

  public getUserPreferences(userId: string): any {
    return this.get(`prefs:${userId}`);
  }
}