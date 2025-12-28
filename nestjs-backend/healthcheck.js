const http = require('http');

const options = {
  hostname: 'localhost',
  port: process.env.PORT || 3000,
  path: '/health/live',
  method: 'GET',
  timeout: 5000,
  headers: {
    'User-Agent': 'Docker-Health-Check/1.0'
  }
};

const request = http.request(options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    if (res.statusCode === 200) {
      try {
        const response = JSON.parse(data);
        if (response.status === 'ok') {
          console.log('Health check passed');
          process.exit(0);
        } else {
          console.error('Health check failed: unhealthy status');
          process.exit(1);
        }
      } catch (error) {
        console.error('Health check failed: invalid response format');
        process.exit(1);
      }
    } else {
      console.error(`Health check failed: HTTP ${res.statusCode}`);
      process.exit(1);
    }
  });
});

request.on('error', (error) => {
  console.error(`Health check failed: ${error.message}`);
  process.exit(1);
});

request.on('timeout', () => {
  console.error('Health check failed: timeout');
  request.destroy();
  process.exit(1);
});

request.setTimeout(5000);
request.end();