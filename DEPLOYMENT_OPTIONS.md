# Deployment Options for AIVA Backend

This document explains the two deployment options available for the AIVA Backend server:

## Option 1: Docker Deployment (Current Default)

The application includes a Dockerfile for containerized deployment. This approach:
- Uses a consistent environment across development and production
- Includes all necessary build tools and dependencies
- Provides more control over the deployment environment

### Files Used:
- `Dockerfile` - Defines the container build process
- `railway.json` - Configures Railway to use Docker deployment

## Option 2: Nixpacks Deployment (Alternative)

Railway's Nixpacks automatically detects and builds Node.js applications. This approach:
- Simpler setup with less configuration
- Automatically handles Node.js version detection
- Uses Railway's optimized build environment

### Files Used:
- `railway-nixpacks.toml` - Configures the Nixpacks build process
- `railway.json` - Configures Railway to use Nixpacks deployment

## Current Configuration

The current configuration uses Docker deployment. To switch to Nixpacks:

1. Update `railway.json` to use Nixpacks builder
2. Ensure `railway-nixpacks.toml` is in the server directory
3. Remove or rename `Dockerfile` to prevent conflicts

## Recommendation

For the AIVA Backend, we recommend using the Docker approach because:
1. It ensures Node.js 20 is used (required for Azure packages)
2. It includes Python and build tools needed for native modules
3. It provides a consistent environment between local development and production

If you encounter persistent issues with Docker, you can try the Nixpacks approach by:
1. Renaming `railway-nixpacks.toml` to `railway.toml`
2. Updating `railway.json` to use the Nixpacks builder
3. Removing the `Dockerfile`