'use strict';
// Test-only loopback transport for exercising real UI against real preload/main/SQLite.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { createAppHarness } = require('./helpers/app-harness');
const root = path.join(__dirname, '..');
const dir = process.argv[2];
if (!dir) throw new Error('Temporary test directory is required');
const h = createAppHarness(dir);
const token = crypto.randomBytes(24).toString('hex');
const methods = Object.keys(h.farmAPI);
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/test-bridge.js') {
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      return res.end(`window.farmAPI = Object.fromEntries(${JSON.stringify(methods)}.map(name => [name, async (...args) => {
        const response = await fetch('/test-api/' + name, { method: 'POST', headers: {'Content-Type':'application/json', 'X-Test-Token':${JSON.stringify(token)}}, body: JSON.stringify(args) });
        return response.json();
      }]));`);
    }
    if (url.pathname.startsWith('/test-api/')) {
      if (req.method !== 'POST' || req.headers['x-test-token'] !== token) { res.writeHead(403); return res.end(); }
      const method = url.pathname.slice('/test-api/'.length);
      if (!methods.includes(method)) throw new Error('Unknown method');
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 16*1024*1024) throw new Error('Payload too large'); chunks.push(chunk); }
      const args = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const result = await h.farmAPI[method](...args);
      res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(result));
    }
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
    const filename = path.resolve(root, rel);
    if (!filename.startsWith(root + path.sep) || !/\.(html|css|js)$/.test(filename)) { res.writeHead(404); return res.end(); }
    let text = fs.readFileSync(filename, 'utf8');
    if (rel === 'index.html') text = text.replace('<script src="js/state.js">', '<script src="/test-bridge.js"></script><script src="js/state.js">');
    res.setHeader('Content-Type', ({'.html':'text/html', '.css':'text/css', '.js':'text/javascript'})[path.extname(filename)] + '; charset=utf-8');
    res.end(text);
  } catch (error) { res.writeHead(500, {'Content-Type':'application/json'}); res.end(JSON.stringify({success:false,message:error.message})); }
});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ port: server.address().port, dbPath: h.dbPath, token, methods })));
