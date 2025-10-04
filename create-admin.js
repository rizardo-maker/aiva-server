// Load environment variables first
require('dotenv').config();

const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const sql = require('mssql');

// Database configuration
const dbConfig = {
  user: process.env.SQL_USERNAME || 'your_username',
  password: process.env.SQL_PASSWORD || 'your_password',
  server: process.env.SQL_SERVER || 'localhost',
  database: process.env.SQL_DATABASE || 'AIVAChat',
  options: {
    encrypt: process.env.SQL_ENCRYPT === 'true',
    trustServerCertificate: process.env.SQL_TRUST_SERVER_CERTIFICATE !== 'false'
  }
};

async function createAdminUser() {
  try {
    console.log('Database config:', {
      server: dbConfig.server,
      database: dbConfig.database,
      user: dbConfig.user
    });
    console.log('Connecting to database...');
    const pool = await sql.connect(dbConfig);
    
    const adminEmail = 'sudhenreddym@gmail.com';
    
    // Check if user exists
    console.log('Checking if admin user exists...');
    const existingUser = await pool.request()
      .input('email', sql.NVarChar, adminEmail)
      .query('SELECT * FROM Users WHERE email = @email');
    
    if (existingUser.recordset.length > 0) {
      console.log('Admin user already exists. Updating role and password...');
      
      // Hash the password
      const hashedPassword = await bcrypt.hash('password123', 12);
      
      // Update existing user
      await pool.request()
        .input('email', sql.NVarChar, adminEmail)
        .input('password', sql.NVarChar, hashedPassword)
        .input('role', sql.NVarChar, 'admin')
        .query('UPDATE Users SET password = @password, role = @role WHERE email = @email');
      
      console.log('✅ Admin user updated successfully!');
    } else {
      console.log('Creating new admin user...');
      
      // Hash the password
      const hashedPassword = await bcrypt.hash('password123', 12);
      
      // Create new user
      const adminUser = {
        id: uuidv4(),
        firstName: 'Sudhen',
        lastName: 'Reddy',
        email: adminEmail,
        password: hashedPassword,
        provider: 'local',
        role: 'admin'
      };
      
      await pool.request()
        .input('id', sql.NVarChar, adminUser.id)
        .input('firstName', sql.NVarChar, adminUser.firstName)
        .input('lastName', sql.NVarChar, adminUser.lastName)
        .input('email', sql.NVarChar, adminUser.email)
        .input('password', sql.NVarChar, adminUser.password)
        .input('provider', sql.NVarChar, adminUser.provider)
        .input('role', sql.NVarChar, adminUser.role)
        .query(`
          INSERT INTO Users (id, firstName, lastName, email, password, provider, providerId, role, preferences)
          VALUES (@id, @firstName, @lastName, @email, @password, @provider, NULL, @role, NULL)
        `);
      
      console.log('✅ Admin user created successfully!');
    }
    
    // Verify the user was created/updated
    const verifyUser = await pool.request()
      .input('email', sql.NVarChar, adminEmail)
      .query('SELECT id, firstName, lastName, email, role, provider FROM Users WHERE email = @email');
    
    console.log('Admin user details:', verifyUser.recordset[0]);
    
    await pool.close();
    console.log('Database connection closed.');
    
  } catch (error) {
    console.error('❌ Error creating admin user:', error);
    process.exit(1);
  }
}

// Environment variables already loaded at the top

createAdminUser();
