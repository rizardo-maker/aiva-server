# AIVA Backend API

A comprehensive backend API for the AIVA (Intelligent Virtual Assistant) application built with Microsoft Azure services.

## 🏗️ Architecture

### Azure Services Used
- **Azure SQL Database** - Relational database for user data, chats, and messages
- **Azure Blob Storage** - File storage for user uploads
- **Azure OpenAI** - AI-powered chat responses
- **Azure App Configuration** - Centralized configuration management
- **Azure Active Directory** - Authentication and authorization
- **Azure Key Vault** - Secure storage for API keys and secrets
- **Azure Monitor** - Logging and monitoring

### Tech Stack
- **Node.js** with **TypeScript**
- **Express.js** - Web framework
- **JWT** - Authentication tokens
- **Winston** - Logging
- **Joi** - Input validation
- **Multer** - File uploads

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ and npm
- Azure subscription
- Azure CLI (optional, for deployment)

### Installation

1. **Clone and setup**
   ```bash
   cd server
   npm install
   ```

2. **Environment Configuration**
   ```bash
   cp .env.example .env
   ```

3. **Configure Azure Services**
   Update `.env` with your Azure service credentials:
   - SQL Database server and credentials
   - Blob Storage account details
   - Azure OpenAI endpoint and key
   - Azure AD tenant and client information
   - Azure Key Vault name

4. **Azure Key Vault Setup**
   The application uses Azure Key Vault to securely store and manage API keys, connection strings, and other secrets.

   a. **Create a Key Vault in Azure**
      - Go to the Azure Portal
      - Create a new Key Vault resource
      - Note the Key Vault name and URL

   b. **Configure Authentication**
      - The application uses DefaultAzureCredential for authentication
      - For local development, you can authenticate using Azure CLI: `az login`
      - For production, use Managed Identity

   c. **Migrate Secrets to Key Vault**
      After setting up your Key Vault, you can migrate your secrets from .env to Key Vault:
      ```bash
      npm run keyvault -- migrate
      ```

   d. **Key Vault Operations**
      The application includes a Key Vault management script with the following commands:
      ```bash
      # List all secrets in Key Vault
      npm run keyvault -- list

      # Get a specific secret
      npm run keyvault -- get SECRET_NAME

      # Set a secret
      npm run keyvault -- set SECRET_NAME SECRET_VALUE

      # Delete a secret
      npm run keyvault -- delete SECRET_NAME
      ```

5. **Start Development Server**
```bash
   npm run dev
   ```

5. **Build for Production**
   ```bash
   npm run build
   npm start
   ```

## 📚 API Documentation

### Authentication Endpoints
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/microsoft/callback` - Microsoft OAuth callback
- `GET /api/auth/verify` - Verify JWT token
- `POST /api/auth/logout` - User logout

### Chat Endpoints
- `GET /api/chat` - Get user's chats
- `POST /api/chat` - Create new chat
- `POST /api/chat/message` - Send message and get AI response
- `GET /api/chat/:chatId/messages` - Get chat messages
- `DELETE /api/chat/:chatId` - Delete chat

### User Endpoints
- `GET /api/user/profile` - Get user profile
- `PUT /api/user/profile` - Update user profile
- `GET /api/user/stats` - Get user statistics
- `DELETE /api/user/account` - Delete user account

### File Endpoints
- `POST /api/files/upload` - Upload file
- `GET /api/files` - Get user's files
- `GET /api/files/download/:fileName` - Download file
- `DELETE /api/files/:fileName` - Delete file

## 🔐 Security Features

### Authentication & Authorization
- JWT-based authentication
- Microsoft OAuth integration
- Role-based access control
- Token expiration and refresh

### Data Protection
- Input validation with Joi
- SQL injection prevention
- XSS protection with Helmet
- Rate limiting
- CORS configuration

### Azure Security
- Azure AD integration
- Cosmos DB with partition keys
- Blob Storage with access controls
- Encrypted data in transit and at rest

## 🗄️ Database Schema

### Users Table
```typescript
{
  id: string,           // Email as primary key
  firstName: string,
  lastName: string,
  email: string,
  password?: string,    // For local auth
  provider: string,     // 'local', 'microsoft', 'google'
  providerId?: string,
  createdAt: string,
  updatedAt: string,
  preferences?: object
}
```

### Chats Table
```typescript
{
  id: string,           // UUID
  userId: string,       // Foreign key to Users
  title: string,
  description: string,
  createdAt: string,
  updatedAt: string,
  messageCount: number
}
```

### Messages Table
```typescript
{
  id: string,           // UUID
  chatId: string,       // Foreign key to Chats
  userId: string,
  content: string,
  role: 'user' | 'assistant',
  createdAt: string
}
```

## 🔧 Configuration

### Environment Variables

For detailed information about configuring environment variables for different environments (development, production, Railway deployment), please refer to the [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) file.

Key variables include:
- `AZURE_TENANT_ID` - Azure AD tenant ID
- `AZURE_CLIENT_ID` - Azure AD application ID
- `AZURE_CLIENT_SECRET` - Azure AD client secret
- `SQL_SERVER` - SQL Database server name
- `SQL_DATABASE` - Database name
- `SQL_USERNAME` - Database username
- `SQL_PASSWORD` - Database password
- `AZURE_STORAGE_ACCOUNT_NAME` - Storage account name
- `AZURE_OPENAI_ENDPOINT` - OpenAI service endpoint
- `JWT_SECRET` - JWT signing secret

### Azure Resource Setup

1. **Create Resource Group**
   ```bash
   az group create --name aiva-rg --location eastus
   ```

2. **Create SQL Database**
   ```bash
   az sql server create --name aiva-sql-server --resource-group aiva-rg --admin-user aivaadmin --admin-password YourPassword123!
   az sql db create --resource-group aiva-rg --server aiva-sql-server --name aiva-db --service-objective Basic
   ```

3. **Create Storage Account**
   ```bash
   az storage account create --name aivastorage --resource-group aiva-rg
   ```

4. **Create OpenAI Service**
   ```bash
   az cognitiveservices account create --name aiva-openai --resource-group aiva-rg --kind OpenAI
   ```

## 📊 Monitoring & Logging

### Winston Logging
- Console logging for development
- File logging for production
- Error tracking and debugging
- Request/response logging

### Azure Monitor Integration
- Application insights
- Performance monitoring
- Error tracking
- Custom metrics

## 🚀 Deployment

### Azure App Service
1. Create App Service plan
2. Deploy using Azure CLI or GitHub Actions
3. Configure environment variables
4. Set up custom domain and SSL

### Docker Deployment
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### Railway.app Deployment

For deploying to Railway.app, please refer to the [RAILWAY_DEPLOYMENT.md](RAILWAY_DEPLOYMENT.md) file for detailed instructions.

## 🧪 Testing

### Unit Tests
```bash
npm test
```

### API Testing
Use tools like Postman or Thunder Client to test endpoints.

### Load Testing
Use Azure Load Testing for performance validation.

## 📈 Performance Optimization

### Caching Strategy
- Redis for session storage (optional)
- SQL Database query optimization with indexes
- Blob Storage CDN integration

### Scaling
- Horizontal scaling with App Service
- Database partitioning
- Load balancing

## 🔍 Troubleshooting

### Common Issues
1. **SQL Database Connection** - Check server name, credentials, and firewall rules
2. **Authentication Errors** - Verify Azure AD configuration
3. **File Upload Issues** - Check storage account permissions
4. **OpenAI Errors** - Verify deployment and quota

### Debugging
- Check application logs in `logs/` directory
- Use Azure Monitor for cloud debugging
- Enable debug logging in development

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Make changes with tests
4. Submit pull request

## 📄 License

This project is licensed under the MIT License.