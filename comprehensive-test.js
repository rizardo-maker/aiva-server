// Comprehensive test script to verify our fixes
require('dotenv').config();
const { DatabaseManager } = require('./dist/config/database');
const { OpenAIService } = require('./dist/services/openai');

async function testDatabaseConnection() {
  console.log('Testing database connection...');
  try {
    const dbManager = DatabaseManager.getInstance();
    const pool = await dbManager.getPool();
    console.log('✅ Database connection successful');
    
    // Test a simple query
    const result = await pool.request().query('SELECT 1 as test');
    console.log('✅ Simple query successful:', result.recordset);
    
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
}

async function testOpenAIService() {
  console.log('\nTesting OpenAI service...');
  try {
    const openAIService = OpenAIService.getInstance();
    
    // Test chat completion with a simple message
    const messages = [
      {
        role: 'system',
        content: 'You are a helpful assistant.'
      },
      {
        role: 'user',
        content: 'Hello, this is a test message. Please respond with "Test successful" and nothing else.'
      }
    ];
    
    console.log('Sending test message to OpenAI...');
    const response = await openAIService.getChatCompletion(messages, { maxTokens: 50 });
    console.log('✅ OpenAI Response:', response.content);
    console.log('✅ Tokens used:', response.tokens);
    
    return true;
  } catch (error) {
    console.error('❌ OpenAI service test failed:', error.message);
    return false;
  }
}

async function runAllTests() {
  console.log('Running comprehensive tests...\n');
  
  const dbSuccess = await testDatabaseConnection();
  const openAISuccess = await testOpenAIService();
  
  console.log('\nTest Results:');
  console.log('=============');
  console.log('Database Connection:', dbSuccess ? '✅ PASS' : '❌ FAIL');
  console.log('OpenAI Service:', openAISuccess ? '✅ PASS' : '❌ FAIL');
  
  if (dbSuccess && openAISuccess) {
    console.log('\n🎉 All tests passed! The message sending issue should now be fixed.');
  } else {
    console.log('\n⚠️  Some tests failed. The message sending issue may not be fully resolved.');
  }
}

// Run the tests
runAllTests().catch((error) => {
  console.error('Test suite failed with error:', error);
});