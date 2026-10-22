// Receives UI dumps posted by the web game page (tools/web-ui/dump-dom.js) and stores them as
// tools/web-ui/dumps/<name>.json. Local only: node tools/web-ui/receiver.mjs  (port 5198)
import { createServer } from 'node:http';
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const dir = fileURLToPath(new URL('./dumps/', import.meta.url));
createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') { res.end(); return; }
  if (req.method === 'GET' && req.url.startsWith('/dump-dom.js')) {
    res.setHeader('Content-Type', 'text/javascript');
    res.end(readFileSync(fileURLToPath(new URL('./dump-dom.js', import.meta.url))));
    return;
  }
  const name = new URL(req.url, 'http://x').searchParams.get('name');
  if (req.method !== 'POST' || !/^[\w-]+$/.test(name || '')) { res.statusCode = 400; res.end('bad'); return; }
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => { writeFileSync(dir + name + '.json', body); res.end('ok ' + body.length); });
}).listen(5198, '127.0.0.1', () => console.log('ui dump receiver on 127.0.0.1:5198'));
