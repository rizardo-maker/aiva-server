# Railway.app Environment Setup

This document explains how to configure environment variables for deploying AIVA Backend to Railway.app.

## Environment Files

- `.env` - Development environment with real credentials (⚠️ DO NOT commit to version control)
- `.env.production` - Template for production environment variables
- `.env.example` - Example template for new developers

## For Railway.app Deployment

When deploying to Railway.app, you should NOT use the `.env` file. Instead, configure all environment variables directly in the Railway dashboard.

### Steps for Railway Deployment:

1. Deploy your application to Railway (via GitHub)
2. Go to your Railway project dashboard
3. Click on your service
4. Go to the "Variables" tab
5. Add all environment variables from the list below

### Environment Variables for Railway

Here are the variables you need to configure in Railway:

```bash
# Azure Key Vault Configuration
AZURE_KEY_VAULT_URL=https://aivakeys.vault.azure.net/

# Microsoft Authentication
AZURE_TENANT_ID=your_azure_tenant_id
AZURE_CLIENT_ID=your_azure_client_id
AZURE_CLIENT_SECRET=your_azure_client_secret
MICROSOFT_REDIRECT_URI=https://${{RAILWAY_PUBLIC_DOMAIN}}/auth/microsoft/callback

# Azure Authentication (explicit variables for DefaultAzureCredential)
AZURE_AUTHORITY_HOST=https://login.microsoftonline.com
AZURE_APP_CONFIG_CONNECTION_STRING=your_azure_app_config_connection_string

# Database Configuration
SQL_SERVER=your_sql_server.database.windows.net
SQL_DATABASE=your_database_name
SQL_USERNAME=your_sql_username
SQL_PASSWORD=your_sql_password
SQL_ENCRYPT=true
SQL_TRUST_SERVER_CERTIFICATE=false
SQL_CONNECTION_TIMEOUT=60000
SQL_REQUEST_TIMEOUT=60000

# Azure Storage Configuration
AZURE_STORAGE_ACCOUNT_NAME=your_storage_account_name
AZURE_STORAGE_CONTAINER_NAME=your_container_name
AZURE_STORAGE_ACCOUNT_KEY=your_storage_account_key
AZURE_STORAGE_CONNECTION_STRING=your_storage_connection_string

# Azure OpenAI Configuration
AZURE_OPENAI_ENDPOINT=https://your-openai-resource.openai.azure.com/
AZURE_OPENAI_API_KEY=your_azure_openai_api_key
AZURE_OPENAI_DEPLOYMENT_NAME=your_deployment_name

# OpenAI Configuration (fallback)
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4

# Security Configuration
JWT_SECRET=your_secure_jwt_secret_key  # Generate a strong secret for production
JWT_EXPIRES_IN=24h
ADMIN_EMAILS=admin1@example.com,admin2@example.com

# Server Configuration
# NOTE: Railway automatically provides the PORT variable
# PORT is automatically set by Railway, so do not set it manually

# Production settings
MOCK_SQL=false
MOCK_DATABASE=false
MOCK_STORAGE=false
MOCK_APP_CONFIG=false
MOCK_OPENAI=false
BYPASS_AUTH=false
NODE_ENV=production
```

## Security Best Practices

1. **Never commit sensitive credentials** to version control
2. **Use Railway's environment variables** for production secrets
3. **Generate strong JWT secrets** for production
4. **Rotate API keys regularly**
5. **Use different credentials** for development and production

## Environment-Specific Configuration

### Development (.env)
- Use `BYPASS_AUTH=true` for easier local testing
- Use `NODE_ENV=development`
- Point [MICROSOFT_REDIRECT_URI](file://c:\Users\sudhe\Downloads\AIVAMobile%201%202\server\src\index.ts#L32-L32) to localhost
- Use local development credentials

### Production (.env.production)
- Use `BYPASS_AUTH=false` for security
- Use `NODE_ENV=production`
- Point [MICROSOFT_REDIRECT_URI](file://c:\Users\sudhe\Downloads\AIVAMobile%201%202\server\src\index.ts#L32-L32) to your Railway URL
- Use production credentials

## Important Notes

1. **PORT Variable**: Railway automatically provides the PORT environment variable. Your application is already configured to use it correctly.

2. **Redirect URIs**: When deploying to Railway, you'll need to update your Microsoft Azure AD application registration to include the Railway URL as a redirect URI.

3. **SSL/TLS**: Railway automatically provides SSL certificates for your application, so all connections will be HTTPS.

4. **Environment Variables Priority**: Railway's environment variables will override any values in your `.env` file.