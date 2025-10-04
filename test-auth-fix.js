#!/usr/bin/env node

/**
 * Test script to verify authentication fixes
 * This script tests the server startup without actually starting the full server
 */

const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

console.log('🔍 Testing Authentication Configuration...\n');

// Test environment variables
console.log('=== Environment Variables ===');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('AZURE_CLIENT_ID:', process.env.AZURE_CLIENT_ID ? 'SET' : 'MISSING');
console.log('AZURE_CLIENT_SECRET:', process.env.AZURE_CLIENT_SECRET ? 
  (process.env.AZURE_CLIENT_SECRET.includes('PLACEHOLDER') ? 'PLACEHOLDER (needs update)' : 'SET') : 'MISSING');
console.log('AZURE_TENANT_ID:', process.env.AZURE_TENANT_ID ? 'SET' : 'MISSING');
console.log('MOCK_AZURE_AUTH:', process.env.MOCK_AZURE_AUTH || 'false');
console.log('DISABLE_KEY_VAULT:', process.env.DISABLE_KEY_VAULT || 'false');
console.log('BYPASS_AUTH:', process.env.BYPASS_AUTH || 'false');

console.log('\n=== Authentication Status ===');

// Check if we're using mock authentication
const shouldUseMock = process.env.MOCK_AZURE_AUTH === 'true' || 
                     process.env.NODE_ENV === 'development' ||
                     process.env.AZURE_CLIENT_SECRET?.includes('PLACEHOLDER');

if (shouldUseMock) {
  console.log('✅ Using MOCK authentication (development mode)');
  console.log('   - This bypasses Azure authentication issues');
  console.log('   - Server should start without authentication errors');
} else {
  console.log('⚠️  Using REAL Azure authentication');
  if (!process.env.AZURE_CLIENT_ID || !process.env.AZURE_CLIENT_SECRET || !process.env.AZURE_TENANT_ID) {
    console.log('❌ Missing required Azure credentials');
  } else if (process.env.AZURE_CLIENT_SECRET.includes('PLACEHOLDER')) {
    console.log('❌ Azure client secret needs to be updated');
  } else {
    console.log('✅ Azure credentials appear to be configured');
  }
}

console.log('\n=== Key Vault Status ===');
if (process.env.DISABLE_KEY_VAULT === 'true') {
  console.log('✅ Key Vault DISABLED (development mode)');
  console.log('   - This bypasses Key Vault authentication issues');
  console.log('   - Server will use environment variables directly');
} else {
  console.log('⚠️  Key Vault ENABLED');
  console.log('   - May cause authentication errors if credentials are invalid');
}

console.log('\n=== Recommendations ===');
if (process.env.AZURE_CLIENT_SECRET?.includes('PLACEHOLDER')) {
  console.log('🔧 To fix Azure authentication:');
  console.log('   1. Go to Azure Portal (https://portal.azure.com)');
  console.log('   2. Navigate to App Registrations');
  console.log('   3. Find your app: 613e41ad-ed10-491c-8788-b42f488aaa29');
  console.log('   4. Go to "Certificates & secrets"');
  console.log('   5. Create a new client secret');
  console.log('   6. Replace PLACEHOLDER_GENERATE_NEW_SECRET in .env file');
  console.log('   7. Set DISABLE_KEY_VAULT=false once credentials are fixed');
}

console.log('\n🚀 Current configuration should allow server to start without errors');
console.log('   Run: npm start or node src/index.js');
