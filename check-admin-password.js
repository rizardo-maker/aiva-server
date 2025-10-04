const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

// Database connection
const dbPath = path.join(__dirname, 'server', 'database.db');
const db = new Database(dbPath);

console.log('Checking admin user password...\n');

try {
  // Get the admin user
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get('sudhenreddym@gmail.com');
  
  if (!user) {
    console.log('❌ Admin user not found');
    process.exit(1);
  }
  
  console.log('📋 Admin user details:');
  console.log(`Email: ${user.email}`);
  console.log(`Name: ${user.firstName} ${user.lastName}`);
  console.log(`Role: ${user.role}`);
  console.log(`Provider: ${user.provider}`);
  console.log(`Password Hash: ${user.passwordHash ? 'Present' : 'Not set'}\n`);
  
  if (!user.passwordHash) {
    console.log('⚠️  No password hash found. This user might use Microsoft authentication only.');
    console.log('💡 Try using Microsoft Sign-In instead of email/password login.\n');
    process.exit(0);
  }
  
  // Test common passwords
  const commonPasswords = ['admin123', 'password', '123456', 'admin', 'test123', 'password123'];
  
  console.log('🔍 Testing common passwords...');
  for (const password of commonPasswords) {
    const isMatch = bcrypt.compareSync(password, user.passwordHash);
    console.log(`   ${password}: ${isMatch ? '✅ MATCH!' : '❌'}`);
    if (isMatch) {
      console.log(`\n🎉 Found password: ${password}`);
      console.log('You can now use this to login in the mobile app.');
      break;
    }
  }
  
} catch (error) {
  console.error('❌ Error:', error.message);
} finally {
  db.close();
}
