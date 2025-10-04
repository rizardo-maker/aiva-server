const http = require('http');

// Test the liked messages API endpoint
console.log('Testing liked messages API endpoint...');

// First, login to get a token
const loginData = JSON.stringify({
  email: 'sudhenreddym@gmail.com',
  password: 'password123'
});

const loginOptions = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/auth/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(loginData)
  }
};

const loginReq = http.request(loginOptions, (res) => {
  let loginResponseData = '';
  
  res.on('data', (chunk) => {
    loginResponseData += chunk;
  });
  
  res.on('end', () => {
    const loginResponse = JSON.parse(loginResponseData);
    console.log('Login status:', res.statusCode);
    
    if (loginResponse.token) {
      console.log('Login successful, testing liked messages API...');
      
      // Test liked messages endpoint
      const likedOptions = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/message-actions/liked',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${loginResponse.token}`
        }
      };
      
      const likedReq = http.request(likedOptions, (res) => {
        let likedResponseData = '';
        
        res.on('data', (chunk) => {
          likedResponseData += chunk;
        });
        
        res.on('end', () => {
          const likedResponse = JSON.parse(likedResponseData);
          console.log('Liked messages status:', res.statusCode);
          console.log('Liked messages response:', JSON.stringify(likedResponse, null, 2));
        });
      });
      
      likedReq.on('error', (error) => {
        console.error('Error calling liked messages API:', error);
      });
      
      likedReq.end();
    } else {
      console.log('Login failed');
      console.log('Response:', loginResponseData);
    }
  });
});

loginReq.on('error', (error) => {
  console.error('Error calling login API:', error);
});

loginReq.write(loginData);
loginReq.end();