#!/bin/bash

# AIVA Local Development Server Startup Script
# This script starts the AIVA backend server with mock services for local development

echo "🚀 Starting AIVA Backend Server in Local Development Mode..."
echo "📍 Server will run on: http://localhost:3001"
echo "🔧 Using mock services (SQL, Storage, OpenAI, etc.)"
echo ""

# Set environment variables for local development with mock services
export MOCK_SQL=true
export MOCK_DATABASE=true
export MOCK_STORAGE=true
export MOCK_APP_CONFIG=true
export MOCK_OPENAI=true
export NODE_ENV=development
export BYPASS_AUTH=true
export PORT=3001
export JWT_SECRET=local-dev-secret

# Start the development server
npm run dev
