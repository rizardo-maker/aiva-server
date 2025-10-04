import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

console.log('Environment Variables Test');
console.log('========================');

console.log('SQL_SERVER:', process.env.SQL_SERVER);
console.log('SQL_DATABASE:', process.env.SQL_DATABASE);
console.log('SQL_USERNAME:', process.env.SQL_USERNAME);
console.log('SQL_PASSWORD:', process.env.SQL_PASSWORD ? '******** (Set)' : 'Not set');
console.log('JWT_SECRET:', process.env.JWT_SECRET ? '******** (Set)' : 'Not set');