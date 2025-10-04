import express from 'express';
import { authRoutes } from '../routes/auth';

// Create a simple test server
const app = express();
const PORT = 3001;

// Middleware
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);

// Test endpoint
app.get('/test', (req, res) => {
  res.json({ message: 'Test server is running' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Test server running on port ${PORT}`);
  console.log(`Test endpoint: http://localhost:${PORT}/test`);
  console.log(`Auth login endpoint: http://localhost:${PORT}/api/auth/login`);
});