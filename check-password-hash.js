const sql = require('mssql');

// Database configuration from .env
const config = {
  server: 'aivaserver.database.windows.net',
  database: 'aivadb',
  user: 'aivadbadmin',
  password: 'ravi@0791',
  options: {
    encrypt: true,
    trustServerCertificate: false
  }
};

async function checkPasswordHash() {
  try {
    console.log('Connecting to database...');
    await sql.connect(config);
    console.log('✅ Connected successfully!');
    
    // Query to check users with passwords
    const result = await sql.query`SELECT id, firstName, lastName, email, password, provider FROM Users WHERE email = 'test@example.com'`;
    
    if (result.recordset.length > 0) {
      const user = result.recordset[0];
      console.log('\n📋 User details:');
      console.log('Email:', user.email);
      console.log('First Name:', user.firstName);
      console.log('Last Name:', user.lastName);
      console.log('Provider:', user.provider);
      console.log('Password Hash:', user.password);
    } else {
      console.log('No user found with email test@example.com');
    }
    
    await sql.close();
  } catch (err) {
    console.error('❌ Database error:', err);
  }
}

checkPasswordHash();