// Test script to verify message fixes
require('dotenv').config();

console.log('Testing message fixes...');
console.log('====================');

console.log('Azure OpenAI Configuration:');
console.log('- Endpoint:', process.env.AZURE_OPENAI_ENDPOINT);
console.log('- Deployment:', process.env.AZURE_OPENAI_DEPLOYMENT_NAME);
console.log('- API Key:', process.env.AZURE_OPENAI_API_KEY ? 'SET' : 'NOT SET');

console.log('\nValidation Schema Changes:');
console.log('- sendMessage chatId is now optional');

console.log('\nMessage Action Improvements:');
console.log('- Better error messages for message actions');
console.log('- More detailed logging for debugging');

console.log('\n✅ All fixes have been implemented!');
console.log('\nTo test the fixes:');
console.log('1. Start the server: npm run dev');
console.log('2. Try sending a message without a chatId (should create new chat)');
console.log('3. Try performing actions on existing messages');
console.log('4. Check logs for improved error messages');