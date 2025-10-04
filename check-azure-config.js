// Check Azure OpenAI configuration
require('dotenv').config();

console.log('Azure OpenAI Configuration Check:');
console.log('=================================');

let endpoint = process.env.AZURE_OPENAI_ENDPOINT || '';
console.log('Original AZURE_OPENAI_ENDPOINT:', endpoint);

// Clean up the endpoint URL if it ends with "/models" or contains full path
if (endpoint.endsWith('/models')) {
  endpoint = endpoint.substring(0, endpoint.length - '/models'.length);
  console.log('Cleaned AZURE_OPENAI_ENDPOINT:', endpoint);
} else if (endpoint.includes('/openai/deployments/')) {
  // Handle full path endpoints by extracting just the base URL
  try {
    const url = new URL(endpoint);
    const originalEndpoint = endpoint;
    endpoint = `${url.protocol}//${url.hostname}`;
    console.log('Extracted base endpoint from full path:', endpoint);
    console.log('Original full path endpoint:', originalEndpoint);
  } catch (e) {
    console.log('Failed to parse endpoint URL:', e.message);
  }
}

console.log('AZURE_OPENAI_DEPLOYMENT_NAME:', process.env.AZURE_OPENAI_DEPLOYMENT_NAME);

// Validate the endpoint format
if (!endpoint) {
  console.log('❌ AZURE_OPENAI_ENDPOINT is not set');
} else {
  console.log('✅ AZURE_OPENAI_ENDPOINT is set');
  
  // Check if it's a valid Azure endpoint
  if (endpoint.includes('azure.com') && !endpoint.endsWith('/')) {
    console.log('✅ Endpoint appears to be a valid Azure endpoint');
  } else if (endpoint.endsWith('/')) {
    console.log('⚠️  Endpoint should not end with a slash');
  } else {
    console.log('⚠️  Endpoint does not appear to be a valid Azure endpoint');
  }
}

if (!process.env.AZURE_OPENAI_DEPLOYMENT_NAME) {
  console.log('❌ AZURE_OPENAI_DEPLOYMENT_NAME is not set');
} else {
  console.log('✅ AZURE_OPENAI_DEPLOYMENT_NAME is set');
}

// Try to construct the full URL
if (endpoint && process.env.AZURE_OPENAI_DEPLOYMENT_NAME) {
  const fullUrl = `${endpoint}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT_NAME}/chat/completions?api-version=2025-01-01-preview`;
  console.log('\nConstructed URL for API calls:');
  console.log(fullUrl);
}

console.log('\nRecommendations:');
console.log('- Make sure your Azure OpenAI resource is properly deployed');
console.log('- Verify that the deployment name "gpt-4o" exists in your Azure OpenAI resource');
console.log('- Check that your API key has the correct permissions');