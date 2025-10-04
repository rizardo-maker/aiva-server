# Deploying AIVA Backend to Railway.app

This guide will help you deploy the AIVA Backend server to Railway.app.

## Prerequisites

1. A GitHub account
2. A Railway.app account
3. The AIVA Backend code repository

## Deployment Steps

### 1. Prepare Your Repository

Make sure your code is pushed to a GitHub repository. The repository should contain:
- All source code in the `src` directory
- `package.json` with all dependencies
- `Dockerfile` for containerized deployment
- `railway.json` for Railway configuration
- `.env` file with your configuration (but without secrets)

### 2. Railway Deployment Options

You can deploy to Railway using one of these methods:

#### Option A: Deploy from GitHub (Recommended)

1. Go to [Railway.app](https://railway.app) and sign in
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose your AIVA Backend repository
5. Railway will automatically detect it's a Node.js project

#### Option B: Deploy using Railway CLI

1. Install the Railway CLI:
   ```bash
   npm install -g @railway/cli
   ```

2. Login to Railway:
   ```bash
   railway login
   ```

3. Initialize a new project:
   ```bash
   railway init
   ```

4. Deploy your application:
   ```bash
   railway up
   ```

### 3. Configure Environment Variables

Railway will automatically inject a `PORT` environment variable. Your application is already configured to use it.

For all other environment variables:

1. In your Railway project, go to the Variables tab
2. Add all the environment variables from your `.env` file
3. For sensitive information like passwords and API keys, add them directly in Railway's dashboard

Required environment variables:
- `AZURE_KEY_VAULT_URL`
- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`
- `MICROSOFT_REDIRECT_URI`
- `AZURE_AUTHORITY_HOST`
- `AZURE_APP_CONFIG_CONNECTION_STRING`
- `SQL_SERVER`
- `SQL_DATABASE`
- `SQL_USERNAME`
- `SQL_PASSWORD`
- `SQL_ENCRYPT`
- `SQL_TRUST_SERVER_CERTIFICATE`
- `SQL_CONNECTION_TIMEOUT`
- `SQL_REQUEST_TIMEOUT`
- `AZURE_STORAGE_ACCOUNT_NAME`
- `AZURE_STORAGE_CONTAINER_NAME`
- `AZURE_STORAGE_ACCOUNT_KEY`
- `AZURE_STORAGE_CONNECTION_STRING`
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_DEPLOYMENT_NAME`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `ADMIN_EMAILS`
- `PORT` (automatically set by Railway)
- `MOCK_SQL`
- `MOCK_DATABASE`
- `MOCK_STORAGE`
- `MOCK_APP_CONFIG`
- `MOCK_OPENAI`
- `BYPASS_AUTH`
- `NODE_ENV`

### 4. Generate a Domain

After deployment, generate a public URL for your app:

1. In your Railway project, go to the Settings tab of your service
2. Click "Generate Domain"
3. Your app will be available at the provided URL

### 5. Health Check

You can check if your application is running correctly by visiting:
- `[YOUR_APP_URL]/health` - Health check endpoint
- `[YOUR_APP_URL]/api` - API information endpoint

## Troubleshooting

### Common Issues

1. **Port Issues**: Railway dynamically assigns ports through the `PORT` environment variable. The application is already configured to use this.

2. **Environment Variables**: Make sure all required environment variables are set in the Railway dashboard.

3. **Build Failures**: Check the build logs in the Railway dashboard for any compilation errors.

4. **Startup Issues**: Check the application logs in the Railway dashboard for runtime errors.

### Logs

You can view your application logs directly in the Railway dashboard or using the CLI:

```bash
railway logs
```

## Scaling

Railway automatically handles scaling for you. If you need to adjust resources:

1. Go to your service in the Railway dashboard
2. Click on the "Settings" tab
3. Adjust the instance size and count as needed

## Notes

- Railway will automatically restart your application if it crashes
- The application is configured to handle graceful shutdowns
- Make sure your Azure services are accessible from Railway's infrastructure