const target = process.argv[2];
if (!target) {
  console.error('Usage: npm run smoke -- https://deployment.example');
  process.exit(2);
}

const url = new URL(target);
if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
  throw new Error('Smoke-test target must use HTTPS outside local development.');
}

const response = await fetch(url, {
  redirect: 'follow',
  signal: AbortSignal.timeout(15_000),
  headers: { 'User-Agent': 'BoomRider-Deployment-Smoke/1.0' },
});
if (!response.ok) throw new Error(`Deployment returned HTTP ${response.status}`);

const html = await response.text();
if (!html.includes('<div id="root"></div>') || !html.includes('BoomRider')) {
  throw new Error('Deployment does not contain the expected BoomRider app shell.');
}

const requiredHeaders = [
  'content-security-policy',
  'x-content-type-options',
  'referrer-policy',
];
const missingHeaders = requiredHeaders.filter((name) => !response.headers.has(name));
if (missingHeaders.length > 0) {
  throw new Error(`Deployment is missing security headers: ${missingHeaders.join(', ')}`);
}

const forbidden = [['VITE', 'GEMINI_API_KEY'].join('_'), 'generativelanguage.googleapis.com'];
const exposed = forbidden.filter((value) => html.includes(value));
if (exposed.length > 0) throw new Error(`Deployment exposes forbidden client content: ${exposed.join(', ')}`);

console.log(`Deployment smoke check passed: ${response.url}`);
