const bcrypt = require('bcryptjs');

// Test password verification
async function testPassword() {
  try {
    // Test with a known password
    const testPassword = 'password123';
    const testHash = '$2a$12$LQv3c1yqBwEJXz1qDIBcdeM3/PwT8I9PkZ9ZrHxrHdQ7OVrmrYw6q'; // This is the hash for 'password123'
    
    console.log('Testing password verification...');
    console.log('Password:', testPassword);
    console.log('Hash:', testHash);
    
    const isValid = await bcrypt.compare(testPassword, testHash);
    console.log('Password is valid:', isValid);
    
    // Test with wrong password
    const wrongPassword = 'wrongpassword';
    const isWrongValid = await bcrypt.compare(wrongPassword, testHash);
    console.log('Wrong password is valid:', isWrongValid);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testPassword();