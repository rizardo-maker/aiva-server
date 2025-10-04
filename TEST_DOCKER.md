# Docker Build Test Instructions

## Local Testing (Optional)

To test if the Dockerfile will work correctly, you can build it locally before deploying to Railway. **Note: This requires Docker Desktop to be installed on your machine.**

If you have Docker installed:

```bash
# Navigate to the server directory
cd server

# Build the Docker image
docker build -t aiva-backend .

# Run the container locally
docker run -p 3001:3001 -e PORT=3001 aiva-backend
```

## Deploying to Railway (Recommended)

If you don't have Docker installed locally (which seems to be the case), you can skip local testing and directly deploy to Railway.app. The Dockerfile has been configured to work with Railway's build environment:

1. The Dockerfile uses Node.js 20 (required by Azure packages)
2. Python and build tools are included for native module compilation
3. Railway will build and run the container in their cloud environment

Simply push your updated code to GitHub, and Railway will automatically build and deploy your application using the Dockerfile.