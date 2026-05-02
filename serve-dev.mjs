import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const root = resolve('dist');
const mimeTypes = {
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.map': 'application/json',
  '.html': 'text/html',
  '.css': 'text/css',
};

createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const filePath = resolve(root, url.slice(1));

  if (!filePath.startsWith(root + sep) && filePath !== root) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const data = await readFile(filePath);
    const mime = mimeTypes[extname(filePath)] ?? 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.writeHead(200);
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(3000, () => {
  console.log('Serving dist/ at http://localhost:3000 (CORS: *)');
});
