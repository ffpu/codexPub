import http from 'node:http';
import https from 'node:https';

const directTLS = Boolean(process.env.TLS_CERT && process.env.TLS_KEY);
const transport = directTLS ? https : http;
const request = transport.get({
  host: '127.0.0.1',
  port: process.env.PORT || 3000,
  path: '/health',
  timeout: 2500,
  ...(directTLS && process.env.PUBLIC_ORIGIN ? { servername: new URL(process.env.PUBLIC_ORIGIN).hostname } : {}),
  ...(!directTLS && process.env.TRUST_PROXY === '1' ? { headers: { 'X-Forwarded-Proto': 'https' } } : {})
}, response => {
  response.resume();
  if (response.statusCode !== 200) process.exitCode = 1;
});
request.on('timeout', () => request.destroy());
request.on('error', () => { process.exitCode = 1; });
