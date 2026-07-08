// Harness de desarrollo para probar api/convert.js sin desplegar:
//   node --experimental-test-module-mocks scripts/vercel-local.mjs
// Simula @vercel/blob guardando los blobs en ./storage/blob-local y expone el
// handler en http://localhost:3333 con la interfaz req/res de Vercel.
import { mock } from 'node:test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.resolve('storage/blob-local');
fs.mkdirSync(OUT_DIR, { recursive: true });

mock.module('@vercel/blob', {
  namedExports: {
    async list({ prefix }) {
      const f = path.join(OUT_DIR, path.basename(prefix));
      if (fs.existsSync(f)) {
        return {
          blobs: [{
            url: `https://fake.blob.vercel-storage.com/${prefix}`,
            size: fs.statSync(f).size,
          }],
        };
      }
      return { blobs: [] };
    },
    async put(pathname, data) {
      const f = path.join(OUT_DIR, path.basename(pathname));
      fs.writeFileSync(f, data);
      return { url: `https://fake.blob.vercel-storage.com/${pathname}` };
    },
  },
});

const { default: handler } = await import('../api/convert.js');

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', () => {
    const vreq = {
      method: req.method,
      headers: req.headers,
      query: Object.fromEntries(url.searchParams),
      body: raw ? JSON.parse(raw) : undefined,
    };
    const vres = {
      _code: 200,
      status(c) { this._code = c; return this; },
      json(obj) {
        res.writeHead(this._code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      },
    };
    Promise.resolve(handler(vreq, vres)).catch((e) => {
      res.writeHead(500);
      res.end(String(e));
    });
  });
}).listen(process.env.PORT ?? 3333, () => console.log('harness listo'));
