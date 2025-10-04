import { ConfigurationManager } from '../configurationManager';

describe('ConfigurationManager', () => {
  let configManager: ConfigurationManager;

  beforeEach(() => {
    configManager = ConfigurationManager.getInstance();
  });

  test('should be a singleton', () => {
    const instance1 = ConfigurationManager.getInstance();
    const instance2 = ConfigurationManager.getInstance();
    expect(instance1).toBe(instance2);
  });

  test('should validate database configuration', async () => {
    const validation = await configManager.validateConfiguration('database');
    expect(validation).toHaveProperty('valid');
    expect(validation).toHaveProperty('errors');
    expect(validation).toHaveProperty('warnings');
  });

  test('should mask sensitive values', () => {
    const config = configManager.getConfiguration('security');
    if (config.JWT_SECRET) {
      expect(config.JWT_SECRET).toContain('••••');
    }
  });
});