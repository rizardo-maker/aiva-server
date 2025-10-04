const bcrypt = require('bcryptjs');

// Test password verification with the mock user's hash
async function verifyMockPassword() {
  try {
    const email = 'john.doe@example.com';
    const password = 'password123';
    const hash = '$2a$12$LQv3c1yqBwEJXz1qDIBcdeM3/PwT8I9PkZ9ZrHxrHdQ7OVrmrYw6q'; // password123 hash from mock database
    
    console.log(`Testing password verification for user: ${email}`);
    console.log(`Password: ${password}`);
    console.log(`Hash: ${hash}`);
    
    const isValid = await bcrypt.compare(password, hash);
    
    if (isValid) {
      console.log('✅ Password verification successful!');
    } else {
      console.log('❌ Password verification failed!');
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

verifyMockPassword();