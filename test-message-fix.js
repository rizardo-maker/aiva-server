const express = require('express');
const { OpenAIService } = require('./dist/services/openai');

async function testOpenAIService() {
  console.log('Testing OpenAI service...');
  
  try {
    // Test OpenAI service
    const openAIService = OpenAIService.getInstance();
    
    // Test chat completion
    const messages = [
      {
        role: 'system',
        content: 'You are a helpful assistant.'
      },
      {
        role: 'user',
        content: 'Hello, how are you?'
      }
    ];
    
    console.log('Sending test message to OpenAI...');
    const response = await openAIService.getChatCompletion(messages);
    console.log('OpenAI Response:', response);
    
  } catch (error) {
    console.error('Error testing OpenAI service:', error.message);
  }
}

// Run the test
testOpenAIService().then(() => {
  console.log('Test completed');
}).catch((error) => {
  console.error('Test failed:', error);
});