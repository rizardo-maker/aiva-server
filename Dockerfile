# Use Node.js 20 LTS as the base image
FROM node:20-alpine

# Set the working directory
WORKDIR /app

# Install Python and build tools for native modules
RUN apk add --no-cache python3 py3-pip make g++

# Copy package.json and package-lock.json
COPY package*.json ./

# Debug: Check if package-lock.json exists
RUN ls -la

# Install all dependencies including dev dependencies
# Use npm ci for faster, reproducible builds, fallback to npm install if package-lock.json is problematic
RUN npm ci || npm install

# Copy the rest of the application code
COPY . .

# Remove dev dependencies to reduce image size for production
# Note: We keep dev dependencies for ts-node execution
# RUN npm prune --production

# Expose the port that Railway will use
EXPOSE $PORT

# Start the application directly with ts-node (skipping compilation)
CMD ["npx", "ts-node", "src/index.ts"]