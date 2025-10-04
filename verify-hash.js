const bcrypt = require('bcryptjs');

// The hash from the database
const hash = '$2a$12$trycakA7GYLhE.Yj0Iz0qesiZGdPZSrOl/3Kuz6kJe4An1BIM82j2';
const password = 'password123';

console.log('Password Verification Test');
console.log('========================');
console.log('Password:', password);
console.log('Hash:', hash);

console.log('\nVerifying password...');

// Synchronous verification
try {
  const isValid = bcrypt.compareSync(password, hash);
  console.log('✅ Password verification result (sync):', isValid);
} catch (error) {
  console.error('❌ Sync verification error:', error.message);
}

// Asynchronous verification
bcrypt.compare(password, hash, (err, isValid) => {
  if (err) {
    console.error('❌ Async verification error:', err.message);
  } else {
    console.log('✅ Password verification result (async):', isValid);
  }
});